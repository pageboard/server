DROP TRIGGER IF EXISTS block_tsv_trigger ON block;
DROP FUNCTION IF EXISTS block_tsv_update();

CREATE TYPE type_site_lang AS (
	_id INTEGER,
	languages JSONB
);

CREATE OR REPLACE FUNCTION block_site(
	block_id INTEGER
) RETURNS type_site_lang
	STABLE
	LANGUAGE sql
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


CREATE INDEX IF NOT EXISTS block_content_name_lang ON block(
	(data->>'name'),
	(data->>'lang')
) WHERE type='content';

CREATE OR REPLACE FUNCTION block_get_content(
	block_id INTEGER,
	_lang TEXT
) RETURNS JSONB
	LANGUAGE sql
	PARALLEL SAFE
	STABLE
AS $BODY$
SELECT jsonb_object(array_agg(content.name), array_agg(content.text))
	FROM (
		SELECT block.data->>'name' AS name, block.data->>'text' AS text
		FROM relation AS r, block
		WHERE r.parent_id = block_id AND block._id = r.child_id
		AND block.type = 'content' AND block.data->>'lang' = _lang
	) AS content;
$BODY$;

CREATE OR REPLACE FUNCTION content_get_headline (
	config regconfig,
	doc TEXT,
	query tsquery
) RETURNS TEXT
	LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
	headline TEXT;
BEGIN
	SELECT trimmed INTO headline FROM (
		SELECT trim(ts_headline) AS trimmed, ts_headline AS text FROM ts_headline(config, doc, query)
	) AS row WHERE length(row.trimmed) > 0 AND length(row.text) != length(doc);
	RETURN headline;
END
$BODY$;

CREATE OR REPLACE FUNCTION content_delete_orphans (
	site_id INTEGER
) RETURNS VOID
	LANGUAGE 'sql'
AS $BODY$
	WITH counts AS (
		SELECT block._id, count(*) OVER (PARTITION BY t.parent_id) AS count
		FROM block, relation AS s, relation AS t
		WHERE s.parent_id = site_id
		AND block._id = s.child_id
		AND block.type = 'content'
		AND t.child_id = block._id
		AND t.parent_id != site_id
	) DELETE FROM block WHERE _id IN (SELECT _id FROM counts WHERE count = 0);
$BODY$;

CREATE OR REPLACE FUNCTION block_insert_content(
	_block block,
	_site type_site_lang
) RETURNS JSONB
	LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
	languages JSONB;
	_lang TEXT;
	block_ids INTEGER[];

	content_ids INTEGER[];
	content_langs TEXT[];
	cur_id INTEGER;
	cur_pos INTEGER;
	cur_lang TEXT;
	_name TEXT;
	_text TEXT;
	is_trivial BOOLEAN;
BEGIN
	languages := _site.languages;
	IF COALESCE(jsonb_array_length(languages), 0) = 0 THEN
		RETURN _block.content;
	END IF;
	_lang := languages->>0;

	FOR _name, _text IN
		SELECT * FROM jsonb_each_text(_block.content)
	LOOP
		IF _text IS NULL OR _text = '' THEN
			-- unlink those named contents
			DELETE FROM relation WHERE id IN (
				SELECT r.id FROM relation AS r, block as content
				WHERE r.parent_id = _block._id
				AND content._id = r.child_id
				AND content.type = 'content'
				AND content.data->>'name' = _name
			);
			CONTINUE;
		END IF;
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
			AND content.data->>'name' = _name
			AND content.data->>'lang' = _lang
			AND content.data->>'text' = _text;

		-- get initial content (id, lang) situation on one of the blocks
		content_ids := ARRAY[]::INTEGER[];
		content_langs := ARRAY[]::TEXT[];
		IF array_length(block_ids, 1) > 0 THEN
			SELECT
				COALESCE(array_agg(content._id), content_ids),
				COALESCE(array_agg(content.data->>'lang'), content_langs)
				INTO content_ids, content_langs
				FROM relation AS r, block AS content
				WHERE r.parent_id = block_ids[1] AND content._id = r.child_id
				AND content.type = 'content'
				AND content.data->>'name' = _name;
		END IF;

		-- ensure current block_id is part of block_ids
		IF _block._id != ALL(block_ids) THEN
			INSERT INTO relation (child_id, parent_id) (
				SELECT unnest(content_ids) AS child_id, _block._id AS parent_id
			);
			block_ids := array_append(block_ids, _block._id);
		END IF;

		-- assume the db is in a valid state
		-- that is, each block has the same number of (name, lang) content childs
		-- which could be zero, or the right number of lang, but all blocks are equal
		-- 1. create the missing (name, lang) contents, if any
		-- 2. link all blocks to them

		-- for each lang, ensure we have content, for all blocks
		is_trivial := starts_with(_text, '<') AND regexp_count(_text, '>\w') = 0;
		FOR cur_lang IN
			SELECT * FROM jsonb_array_elements_text(languages)
		LOOP
			cur_pos := array_position(content_langs, cur_lang);
			IF cur_pos > 0 THEN
				content_ids[cur_pos] := NULL;
				content_langs[cur_pos] := NULL;
				CONTINUE;
			END IF;
			-- missing, create content
			INSERT INTO block (id, type, data) VALUES (
				replace(gen_random_uuid()::text, '-', ''),
				'content',
				jsonb_build_object(
					'name', _name,
					'lang', cur_lang,
					'text', (CASE WHEN (_lang = cur_lang OR is_trivial) THEN _text ELSE '' END)
				)
			) RETURNING block._id INTO cur_id;
			INSERT INTO relation (child_id, parent_id) VALUES (cur_id, _site._id);
			-- link content to all blocks
			INSERT INTO relation (child_id, parent_id) (
				SELECT cur_id AS child_id, unnest(block_ids) AS parent_id
			);
		END LOOP;

		-- remaining content_ids must be removed from all blocks
		DELETE FROM block WHERE _id	IN (
			SELECT unnest(content_ids)
		);
	END LOOP;
	RETURN '{}'::jsonb;
END
$BODY$;

CREATE OR REPLACE FUNCTION content_lang_insert_func() RETURNS trigger
	LANGUAGE plpgsql
AS $BODY$
DECLARE
	_site type_site_lang;
	_block block;
BEGIN
	UPDATE block SET content = content WHERE _id = NEW.child_id AND type != 'content' AND COALESCE(content, '{}'::jsonb) != '{}'::jsonb;
	RETURN NEW;
END
$BODY$;

CREATE OR REPLACE TRIGGER content_lang_trigger_insert AFTER INSERT ON relation FOR EACH ROW EXECUTE FUNCTION content_lang_insert_func();

CREATE OR REPLACE FUNCTION block_delete_content(
	_block block,
	_site type_site_lang,
	keep_names TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS VOID
	LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
	IF COALESCE(jsonb_array_length(_site.languages), 0) = 0 THEN
		RETURN;
	END IF;

	WITH contents AS (
		SELECT content._id
		FROM relation AS r, block AS content
		WHERE r.parent_id = _block._id AND content._id = r.child_id
		AND content.type = 'content'
		AND content.data->>'name' != ALL(keep_names)
	), counts AS (
		SELECT contents._id, count(relation.*) AS n
		FROM contents, relation WHERE relation.child_id = contents._id AND relation.parent_id != _site._id AND relation.parent_id != _block._id GROUP BY contents._id
	)
	DELETE FROM block USING counts WHERE block._id = counts._id AND counts.n = 0;
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
	keep_names TEXT[];
BEGIN
	_site := block_site(NEW._id);
	keep_names := ARRAY(SELECT jsonb_object_keys(NEW.content));
	PERFORM block_delete_content(OLD, _site, keep_names);
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
