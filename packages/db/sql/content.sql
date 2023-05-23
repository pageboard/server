DROP TRIGGER block_tsv_trigger ON block;
DROP FUNCTION block_tsv_update();

CREATE OR REPLACE FUNCTION block_site(
	block_id INTEGER
) RETURNS SETOF block
	PARALLEL SAFE
	LANGUAGE plpgsql
AS $BODY$
BEGIN
	RETURN QUERY SELECT block.* FROM relation, block WHERE relation.child_id = block_id AND block._id = relation.parent_id AND block.type = 'site' LIMIT 1;
	RETURN;
END
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
	 LANGUAGE plpgsql
AS $BODY$
DECLARE
	_block block;
BEGIN
	INSERT INTO block (id, standalone, type, data) VALUES (
		replace(gen_random_uuid()::text, '-', ''), TRUE, _type, data
	) RETURNING block.* INTO _block;
	RETURN _block;
END
$BODY$;

CREATE OR REPLACE FUNCTION content_tsv_func() RETURNS trigger
	LANGUAGE plpgsql
AS $BODY$
DECLARE
	_tsconfig regconfig;
	_site block;
BEGIN
	IF NEW.type = 'content' THEN
		SELECT COALESCE(data->>'tsconfig', 'unaccent')
			INTO _tsconfig
			FROM block
			WHERE type='language'
			AND data @@ FORMAT('$.lang == %s', NEW.data->'lang')::jsonpath;
		NEW.tsv := to_tsvector(_tsconfig::regconfig, NEW.data->>'text');
	ELSE
		NEW.tsv := to_tsvector('unaccent', NEW.content);
	END IF;
	RETURN NEW;
END
$BODY$;

CREATE OR REPLACE TRIGGER content_tsv_trigger_insert BEFORE INSERT ON block FOR EACH ROW EXECUTE FUNCTION content_tsv_func();
CREATE OR REPLACE TRIGGER content_tsv_trigger_update_text BEFORE UPDATE OF data ON block FOR EACH ROW WHEN (NEW.type = 'content' AND NEW.data['text'] != OLD.data['text']) EXECUTE FUNCTION content_tsv_func();
CREATE OR REPLACE TRIGGER block_tsv_trigger_update_content BEFORE UPDATE OF content ON block FOR EACH ROW WHEN (NEW.type != 'content') EXECUTE FUNCTION content_tsv_func();

CREATE OR REPLACE FUNCTION block_get_content(
	block_id INTEGER,
	_lang TEXT DEFAULT NULL
) RETURNS JSONB
	LANGUAGE plpgsql
	PARALLEL SAFE
AS $BODY$
DECLARE
	_obj JSONB;
BEGIN
	IF _lang IS NULL THEN
		SELECT content INTO _obj FROM block WHERE _id = block_id;
	ELSE
		SELECT jsonb_object(array_agg(content.name), array_agg(content.text))
		INTO _obj
		FROM (
			SELECT block.data->>'name' AS name, block.data->>'text' AS text
			FROM relation AS r, block
			WHERE r.parent_id = block_id AND block._id = r.child_id
			AND block.type = 'content' AND block.data @@ FORMAT('$.lang == %s', to_json(_lang))::jsonpath
		) AS content;
	END IF;
	RETURN _obj;
END
$BODY$;

CREATE OR REPLACE FUNCTION block_set_content(
	block_id INTEGER,
	_obj JSONB,
	_lang TEXT DEFAULT NULL
) RETURNS JSONB
	LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
	_site block;
	content_names JSONB;
	block_ids INTEGER[];
	content_ids INTEGER[];
	content_langs TEXT[];
	cur_id INTEGER;
	cur_pos INTEGER;
	cur_lang TEXT;
	_name TEXT;
	_text TEXT;
BEGIN
	IF _lang IS NULL THEN
		RETURN _obj;
	END IF;
	_site := block_site(block_id);
	-- int[text][] map of old block contents
	SELECT COALESCE(jsonb_object_agg(name, ids), '{}'::jsonb)
	INTO content_names
	FROM (
		SELECT block.data->>'name' AS name, jsonb_agg(block._id) AS ids
		FROM relation AS r, block
		WHERE r.parent_id = block_id AND block._id = r.child_id AND block.type = 'content' GROUP BY name
	) AS content;

	FOR _name, _text IN
		SELECT * FROM jsonb_each_text(_obj)
	LOOP
		IF _text IS NULL OR _text = '' THEN
			-- will unlink
			CONTINUE;
		ELSE
			-- remaining content_names will be unlinked from block_id
			content_names := content_names - _name;
		END IF;

		-- list all block._id that have a matching content text for that name/lang
		SELECT COALESCE(array_agg(other._id), ARRAY[]::INTEGER[]) INTO block_ids
		FROM block, relation AS block_site,
		block AS other,
		relation AS content_block, block AS content
			WHERE block._id = block_id
			AND block_site.parent_id = _site._id
			AND other._id = block_site.child_id AND other.type = block.type
			AND content_block.parent_id = other._id
			AND content._id = content_block.child_id
			AND content.type = 'content'
			AND content.data @@ FORMAT(
				'$.lang == %s && $.name == %s && $.text == %s',
				to_json(_lang),
				to_json(_name),
				to_json(_text)
			)::jsonpath;

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
				AND content.data @@ FORMAT('$.name == %s', to_json(_name))::jsonpath;
		END IF;

		-- ensure current block_id is part of block_ids
		IF NOT block_id = ANY(block_ids) THEN
			INSERT INTO relation (child_id, parent_id) (
				SELECT unnest(content_ids) AS child_id, block_id AS parent_id
			);
			block_ids := array_append(block_ids, block_id);
		END IF;

		-- assume the db is in a valid state
		-- that is, each block has the same number of (name, lang) content childs
		-- which could be zero, or the right number of lang, but all blocks are equal
		-- 1. create the missing (name, lang) contents, if any
		-- 2. link all blocks to them

		-- for each lang, ensure we have content, for all blocks
		FOR cur_lang IN
			SELECT * FROM jsonb_array_elements_text(_site.data['languages'])
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
					'text', (CASE WHEN (_lang = cur_lang) THEN _text ELSE '' END)
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

	FOR _name IN
		SELECT jsonb_object_keys(content_names)
	LOOP
		-- convert jsonb to int[]
		SELECT array_agg(value)::int[] INTO content_ids
			FROM jsonb_array_elements(content_names[_name]);
		-- unrelate
		DELETE FROM relation WHERE parent_id = block_id AND child_id IN (
			SELECT unnest(content_ids)
		);
		-- delete orphaned content
		DELETE FROM block WHERE _id IN (
			SELECT unnest(content_ids)
		) AND NOT EXISTS (
			SELECT FROM relation WHERE child_id = block._id AND parent_id != _site._id
		);
	END LOOP;
	RETURN '{}'::jsonb;
END
$BODY$;


CREATE OR REPLACE FUNCTION jsonb_headlines (
	config regconfig,
	doc JSONB,
	query tsquery
) RETURNS TEXT[]
	LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
	headlines TEXT[];
BEGIN
	SELECT array_agg(list.fragment) INTO headlines FROM (
		SELECT fragment FROM (
			SELECT value AS fragment, jsonb_extract_path_text(doc, key) AS field
				FROM jsonb_each_text(ts_headline(config, doc, query))
		) AS headlines WHERE length(fragment) != length(field)
	) AS list WHERE length(trim(list.fragment)) > 0;
	RETURN headlines;
END
$BODY$;

