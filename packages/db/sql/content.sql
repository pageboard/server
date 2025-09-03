DROP TRIGGER IF EXISTS block_tsv_trigger ON block;
DROP FUNCTION IF EXISTS block_tsv_update();

CREATE TYPE type_site_lang AS (
	_id INTEGER,
	languages JSONB
);

CREATE OR REPLACE FUNCTION block_site(
	block_id INTEGER
) RETURNS type_site_lang
	PARALLEL SAFE
	LANGUAGE sql
	STABLE
AS $BODY$
	SELECT block._id, block.data['languages'] FROM relation, block WHERE relation.child_id = block_id AND block._id = relation.parent_id AND block.type = 'site' LIMIT 1;
$BODY$;

CREATE OR REPLACE FUNCTION block_find(
	_site_id INTEGER,
	_type TEXT,
	_path TEXT,
	_value TEXT
) RETURNS block
	PARALLEL SAFE
	STABLE
	LANGUAGE plpgsql
AS $BODY$
DECLARE
	_block block;
BEGIN
	SELECT INTO _block block.* FROM relation AS r, block WHERE r.parent_id = _site_id AND block._id = r.child_id AND block.type = _type AND block.data @@ FORMAT('$.%s == %s', _path, to_json(_value))::jsonpath LIMIT 1;
	IF FOUND THEN
		RETURN _block;
	ELSE
		RETURN NULL;
	END IF;
END
$BODY$;

CREATE OR REPLACE FUNCTION block_insert(
	_type TEXT,
	data JSONB
) RETURNS block
	 LANGUAGE sql
AS $BODY$
INSERT INTO block (id, standalone, type, data) VALUES (
	replace(gen_random_uuid()::text, '-', ''), TRUE, _type, data
) RETURNING block.*;
$BODY$;

CREATE OR REPLACE FUNCTION content_tsv_func() RETURNS trigger
	LANGUAGE plpgsql
AS $BODY$
DECLARE
	_tsconfig regconfig;
BEGIN
	SELECT COALESCE(data->>'tsconfig', 'unaccent')
		INTO _tsconfig
		FROM block
		WHERE type='language'
		AND data @@ FORMAT('$.lang == %s', NEW.data->'lang')::jsonpath;
	NEW.tsv := to_tsvector(_tsconfig::regconfig, NEW.data->>'text');
	RETURN NEW;
END
$BODY$;

CREATE OR REPLACE TRIGGER content_tsv_trigger_insert BEFORE INSERT ON block FOR EACH ROW  WHEN (NEW.type = 'content') EXECUTE FUNCTION content_tsv_func();
CREATE OR REPLACE TRIGGER content_tsv_trigger_update_text BEFORE UPDATE OF data ON block FOR EACH ROW WHEN (NEW.type = 'content' AND NEW.data['text'] != OLD.data['text']) EXECUTE FUNCTION content_tsv_func();


CREATE INDEX IF NOT EXISTS block_content_name_lang ON block (
	(data->>'name'),
	(data->>'lang')
) WHERE type='content';

DROP FUNCTION IF EXISTS block_get_content(INTEGER, TEXT);
DROP FUNCTION IF EXISTS block_get_content (INTEGER, TEXT, TEXT);
-- This is used by block_get_content_row(INTEGER, TEXT, TEXT)
-- pageboard 0.13 and 0.14
-- DROP TYPE IF EXISTS type_content_translated;

-- pageboard >= 0.15
CREATE OR REPLACE FUNCTION block_get_content (
	block_id INTEGER,
	_lang TEXT,
	_content TEXT[] DEFAULT NULL
) RETURNS JSONB
	LANGUAGE sql
	PARALLEL SAFE
	STABLE
AS $BODY$
SELECT
	CASE WHEN count(contents.name) = 0 THEN '{}'::jsonb ELSE jsonb_object(array_agg(contents.name), array_agg(contents.text)) END AS content
FROM (
	SELECT
		block.data->>'name' AS name,
		block.data->>'text' AS text,
		block.data['valid']::boolean AS valid
	FROM relation AS r, block
	WHERE r.parent_id = block_id AND block._id = r.child_id
	AND block.type = 'content' AND block.data->>'lang' = _lang
	AND (CASE WHEN _content IS NOT NULL THEN block.data->>'name' = ANY(_content) ELSE TRUE END)
) AS contents
$BODY$;

CREATE OR REPLACE FUNCTION content_get_headline (
	config regconfig,
	doc TEXT,
	query tsquery
) RETURNS TEXT
	LANGUAGE 'sql'
	PARALLEL SAFE
	STABLE
AS $BODY$
SELECT trimmed AS headline FROM (
	SELECT trim(ts_headline) AS trimmed, ts_headline AS text FROM ts_headline(config, doc, query)
) AS row WHERE length(row.trimmed) > 0 AND length(row.text) != length(doc);
$BODY$;

CREATE OR REPLACE FUNCTION block_delete_orphans (
	site_id INTEGER,
	days INTEGER DEFAULT 0,
	delete_content BOOLEAN DEFAULT FALSE
) RETURNS INTEGER
	LANGUAGE 'sql'
AS $BODY$
	WITH counts AS (
		SELECT block._id, count(*)
		FROM relation AS s, block LEFT OUTER JOIN relation AS t
		ON t.child_id = block._id
		WHERE s.parent_id = site_id
		AND block._id = s.child_id
		AND (block.standalone IS FALSE OR delete_content IS TRUE AND block.type = 'content')
		AND extract('day' from now() - block.updated_at) >= days
		GROUP BY block._id
	),
	dels AS (
		DELETE FROM block WHERE _id IN (SELECT _id FROM counts WHERE count = 1) RETURNING _id
	) SELECT count(*) FROM dels;
$BODY$;
DROP FUNCTION IF EXISTS block_delete_orphans (integer);

CREATE OR REPLACE FUNCTION content_delete_name(
	p_id INTEGER,
	p_name TEXT
) RETURNS INTEGER
	LANGUAGE 'sql'
AS $BODY$
	WITH sels AS (
		SELECT r.id FROM relation AS r, block as content
			WHERE r.parent_id = p_id
			AND content._id = r.child_id
			AND content.type = 'content'
			AND content.data->>'name' = p_name
	),
	dels AS (
		DELETE FROM relation USING sels WHERE relation.id = sels.id RETURNING relation.id
	) SELECT count(*) FROM dels;
$BODY$;

CREATE OR REPLACE FUNCTION block_insert_content(
	_block block,
	_site type_site_lang
) RETURNS JSONB
	LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
	languages JSONB;
	def_lang TEXT;
	block_ids INTEGER[];

	content_ids INTEGER[];
	content_langs TEXT[];
	cur_id INTEGER;
	cur_pos INTEGER;
	cur_lang TEXT;
	cur_name TEXT;
	cur_text TEXT;
	old_text TEXT;
	is_trivial BOOLEAN;
	cur_valid BOOLEAN;
BEGIN
	languages := _site.languages;
	IF COALESCE(jsonb_array_length(languages), 0) = 0 THEN
		RETURN _block.content;
	END IF;
	def_lang := languages->>0;

	FOR cur_name, cur_text IN
		SELECT * FROM jsonb_each_text(_block.content)
	LOOP
		IF cur_text IS NULL OR cur_text = '' THEN
			-- unlink those named contents
			PERFORM content_delete_name(_block._id, cur_name);
			CONTINUE;
		END IF;
		is_trivial := starts_with(cur_text, '<') AND regexp_count(cur_text, '>\w') = 0;
		-- list all block._id that have a matching content text for that name/lang
		SELECT COALESCE(array_agg(block._id), ARRAY[]::INTEGER[])
		INTO block_ids
		FROM relation AS block_site, block,
		relation AS content_block, block AS content
			WHERE block_site.parent_id = _site._id
			AND (block._id = block_site.child_id AND block.type = _block.type)
			AND content_block.parent_id = block._id
			AND content._id = content_block.child_id
			AND content.type = 'content'
			AND content.data->>'name' = cur_name
			AND content.data->>'lang' = def_lang
			AND content.data->>'text' = cur_text;

		content_ids := ARRAY[]::INTEGER[];
		content_langs := ARRAY[]::TEXT[];

		-- two situations: there are some block_ids, or there aren't
		IF array_length(block_ids, 1) > 0 THEN
			SELECT
				COALESCE(array_agg(content._id), content_ids),
				COALESCE(array_agg(content.data->>'lang'), content_langs)
				INTO content_ids, content_langs
				FROM relation AS r, block AS content
				WHERE r.parent_id = block_ids[1] AND content._id = r.child_id
				AND content.type = 'content'
				AND content.data->>'name' = cur_name;
			IF _block._id = ANY(block_ids) THEN
				-- there is already our block in that list
			ELSE
				-- our block is not in that list
				-- remove old content
				PERFORM content_delete_name(_block._id, cur_name);
				-- link our block to the contents
				INSERT INTO relation (child_id, parent_id) (
					SELECT unnest(content_ids) AS child_id, _block._id AS parent_id
				);
				-- add our block to that list
				block_ids := array_append(block_ids, _block._id);
			END IF;
			-- at this point the original content exists by construction
			-- and all contents are linked to all blocks and ours
			-- check each lang
			FOR cur_lang IN
				SELECT * FROM jsonb_array_elements_text(languages)
			LOOP
				-- do existing content has that lang ?
				cur_pos := array_position(content_langs, cur_lang);
				IF cur_pos IS NOT NULL THEN
					-- yes, mark it as so
					content_ids[cur_pos] := NULL;
					content_langs[cur_pos] := NULL;
				ELSE
					-- no, insert and link to all blocks
					cur_valid := def_lang = cur_lang OR is_trivial;
					INSERT INTO block (id, type, data) VALUES (
						replace(gen_random_uuid()::text, '-', ''),
						'content',
						jsonb_build_object(
							'name', cur_name,
							'lang', cur_lang,
							'valid', cur_valid,
							'text', CASE WHEN cur_valid THEN cur_text ELSE '' END
						)
					) RETURNING block._id INTO cur_id;
					INSERT INTO relation (child_id, parent_id) VALUES (cur_id, _site._id);
					INSERT INTO relation (child_id, parent_id) (
						SELECT cur_id AS child_id, unnest(block_ids) AS parent_id
					);
				END IF;
			END LOOP;

			-- remaining unmarked contents must be unlinked and deleted
			DELETE FROM block WHERE _id	IN (
				SELECT unnest(content_ids)
			);
		ELSE
			-- check each lang
			FOR cur_lang IN
				SELECT * FROM jsonb_array_elements_text(languages)
			LOOP
				cur_valid := def_lang = cur_lang OR is_trivial;

				-- get old content if any
				SELECT r.id, content.data->>'text' INTO cur_id, old_text
					FROM relation AS r, block AS content
					WHERE r.parent_id = _block._id
					AND content._id = r.child_id
					AND content.type = 'content'
					AND content.data->>'name' = cur_name
					AND content.data->>'lang' = cur_lang;
				-- delete old content
				IF cur_id IS NOT NULL THEN
					DELETE FROM relation WHERE id = cur_id;
				END IF;

				INSERT INTO block (id, type, data) VALUES (
					replace(gen_random_uuid()::text, '-', ''),
					'content',
					jsonb_build_object(
						'name', cur_name,
						'lang', cur_lang,
						'valid', cur_valid,
						'text', CASE WHEN cur_valid THEN cur_text ELSE '' END
					)
				) RETURNING block._id INTO cur_id;
				INSERT INTO relation (child_id, parent_id) VALUES (cur_id, _site._id);
				INSERT INTO relation (child_id, parent_id) VALUES (cur_id, _block._id);
			END LOOP;
		END IF;
	END LOOP;
	RETURN '{}'::jsonb;
END
$BODY$;

CREATE OR REPLACE FUNCTION content_lang_insert_func() RETURNS trigger
	LANGUAGE plpgsql
AS $BODY$
BEGIN
	UPDATE block SET content = content WHERE _id = NEW.child_id AND type != 'content' AND COALESCE(content, '{}'::jsonb) != '{}'::jsonb;
	RETURN NEW;
END
$BODY$;

CREATE OR REPLACE TRIGGER content_lang_trigger_insert AFTER INSERT ON relation FOR EACH ROW EXECUTE FUNCTION content_lang_insert_func();

CREATE OR REPLACE FUNCTION block_delete_content(
	_block block,
	_site type_site_lang
) RETURNS VOID
	LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
	content_ids INTEGER[];
	rel_ids INTEGER[];
BEGIN
	IF COALESCE(jsonb_array_length(_site.languages), 0) = 0 THEN
		RETURN;
	END IF;

	SELECT array_agg(r.id), array_agg(content._id)
		INTO rel_ids, content_ids
		FROM relation AS r, block AS content
		WHERE r.parent_id = _block._id AND content._id = r.child_id
		AND content.type = 'content';
	DELETE FROM relation WHERE id IN (SELECT unnest(rel_ids));


	WITH counts AS (
		SELECT child_id AS _id, count(*) AS n
		FROM relation WHERE child_id IN (
			SELECT unnest(content_ids)
		) GROUP BY child_id
	) DELETE FROM block USING counts WHERE block._id = counts._id AND counts.n = 1;
END
$BODY$;


CREATE OR REPLACE FUNCTION content_lang_delete_func() RETURNS trigger
	LANGUAGE plpgsql
AS $BODY$
DECLARE
	_site type_site_lang;
BEGIN
	_site := block_site(OLD._id);
	PERFORM block_delete_content(OLD, _site);
	RETURN OLD;
END
$BODY$;

CREATE OR REPLACE TRIGGER content_lang_trigger_delete BEFORE DELETE ON block FOR EACH ROW WHEN (COALESCE(OLD.content, '{}'::jsonb) != '{}'::jsonb) EXECUTE FUNCTION content_lang_delete_func();

CREATE OR REPLACE FUNCTION content_lang_update_func() RETURNS trigger
	LANGUAGE plpgsql
AS $BODY$
DECLARE
	_site type_site_lang;
BEGIN
	_site := block_site(NEW._id);
	NEW.content := block_insert_content(NEW, _site);
	IF NEW.content = '{}'::jsonb THEN
		NEW.tsv = NULL;
	ELSE
		NEW.tsv = to_tsvector('unaccent', NEW.content);
	END IF;
	RETURN NEW;
END
$BODY$;

CREATE OR REPLACE TRIGGER content_lang_trigger_update BEFORE UPDATE OF content ON block FOR EACH ROW WHEN (NEW.type != 'content') EXECUTE FUNCTION content_lang_update_func();
