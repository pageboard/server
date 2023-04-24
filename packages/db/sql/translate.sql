BEGIN;
CREATE TABLE language (
	lang TEXT PRIMARY KEY,
	name TEXT,
	translation TEXT,
	tsconfig TEXT
);
INSERT INTO language (lang, name, translation, tsconfig) VALUES ('', 'Unaccent', NULL, 'unaccent');
COMMIT;

CREATE TEXT SEARCH CONFIGURATION unaccent ( COPY = simple );
ALTER TEXT SEARCH CONFIGURATION unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

INSERT INTO language (lang, name, translation, tsconfig) VALUES ('fr', 'French', 'fr', 'french');


CREATE OR REPLACE FUNCTION translate_find_language(_lang TEXT) RETURNS language AS $$
DECLARE
	_row language;
BEGIN
	SELECT * FROM language WHERE lang IN (_lang, '') ORDER BY lang DESC INTO _row;
	RETURN _row;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION translate_find_dictionary(block_id INTEGER)
	RETURNS block AS $$
DECLARE
	_result block;
	_site_id INTEGER;
BEGIN
	_site_id := site._id FROM relation, block AS site WHERE relation.child_id = block_id AND site._id = relation.parent_id AND site.type = 'site';

	_result := dict.*
		FROM relation AS block_parent, block AS parent, block AS dict, relation AS dict_site
		WHERE block_parent.child_id = block_id AND parent._id = block_parent.parent_id
		AND dict.type = 'dictionary' AND dict.id = parent.data->>'dictionary'
		AND dict_site.child_id = dict._id AND dict_site.parent_id = _site_id
		ORDER BY CASE WHEN parent.type = 'site' THEN 1 ELSE 0 END
		LIMIT 1
		INTO _result;
	RETURN _result;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_block_content(_block block, _lang TEXT) RETURNS JSONB AS $$
DECLARE
	_dict block;
	_target JSONB;
	_translation block;
	_key TEXT;
	_value TEXT;
	_translated JSONB[];
BEGIN
	SELECT * FROM translate_find_dictionary(_block._id) INTO _dict;
	IF NOT _lang IN _dict.data['targets'] THEN
		RAISE EXCEPTION 'Unknown lang: %', _lang  USING ERRCODE = 'invalid_parameter_value'; -- 22023
	END IF;
	IF _dict.data->>'source' = _lang THEN
		RETURN _block.content;
	END IF;
	FOR _key, _value IN
		SELECT item->>'key', item->>'value' FROM unnest(_block.content) AS item;
	LOOP
		SELECT * FROM translate_find_translation(_block.type, _key, _value, _dict._id) INTO _translation;
		IF _translation._id IS NOT NULL AND _translation.verified[_lang]::boolean IS TRUE THEN
			SELECT block_get_content(_translation.content, _lang) INTO _target;
		END IF;
		IF _target IS NULL THEN
			_target := _value;
		END IF;
		PERFORM array_append(_translated, jsonb_build_object('key', _key, 'value', _target));
	END LOOP;
	RETURN _translated;
END
$$ LANGUAGE plpgsql;

-- CREATE OR REPLACE FUNCTION array_of_jsonb_find(_arr JSONB[], _key TEXT, _val TEXT) RETURNS JSONB AS $$
-- DECLARE
-- 	_ret JSONB;
-- BEGIN
-- 	_ret := jsonb_path_query_first(array_to_json(_arr)::jsonb, FORMAT('$[*] ? (@.%s == %s)', _key, _val)::jsonpath);
-- 	RETURN _ret;
-- END
-- $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_find_translation(_type TEXT, _key TEXT, _value TEXT, dict_id INTEGER) RETURNS block AS $$
DECLARE
	_result block;
BEGIN
	SELECT block.* FROM block, relation
		WHERE relation.parent_id = dict_id
		AND block._id = relation.child_id
		AND block.type = 'translation'
		AND block.data->>'type' = _type
		AND block.data->>'content' = _key
		AND block.data['source'] = _value
		INTO _result;
	RETURN _result;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_find_blocks(_translation block, dict_id INTEGER) RETURNS SETOF block AS $$
BEGIN
	RETURN QUERY SELECT block.* FROM block, relation, block AS parent, block AS dict
		WHERE dict._id = dict_id AND parent.data['dictionary']::text = dict.id
		AND relation.parent_id = parent._id
		AND block._id = relation.child_id
		AND block.type = _translation.data->>'type'
		AND jsonb_path_exists(array_to_json(block.content)::jsonb, format('$[*] ? (@.%s == %s)', _translation.data->>'content', _translation.data['source'])::jsonpath)
	RETURN;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE PROCEDURE translate_new_translation(_dict block, _block block, _key TEXT) AS $$
DECLARE
	translation_id INTEGER;
	site_id INTEGER;
	cur_id TEXT;
	_content TEXT;
	_target TEXT;
BEGIN
	_content := block_get_content(_block.content, _key)::text;
	IF _content IS NULL OR _content = '""' OR (starts_with(_content, '"<') AND regexp_count(_content, '>\w') = 0) THEN
		RETURN;
	END IF;

	SELECT relation.parent_id FROM relation WHERE relation.child_id = _dict._id INTO STRICT site_id;

	INSERT INTO block (id, type, data) VALUES (
			replace(gen_random_uuid()::text, '-', ''),
			'translation',
			jsonb_build_object(
				'type', _block.type,
				'content', _key,
				'source', _content,
				'verified': '{}'::jsonb
			)
		) RETURNING block._id INTO translation_id;
	INSERT INTO relation (child_id, parent_id) VALUES (translation_id, site_id);
	INSERT INTO relation (child_id, parent_id) VALUES (translation_id, _dict._id);
END
$$ LANGUAGE plpgsql;

-- Insert new translation if none is found
CREATE OR REPLACE PROCEDURE translate_content_insert(_block block) AS $$
DECLARE
	_dict block;
	_key TEXT;
	_translation block;
BEGIN
	SELECT * FROM translate_find_dictionary(_block._id) INTO _dict;
	IF _dict._id IS NULL THEN
		RETURN;
	END IF;
	FOR _key, _value IN
		SELECT item->>'key', item->>'value' FROM unnest(_block.content) AS item;
	LOOP
		SELECT * FROM translate_find_translation(_block.type, _key, _value, _dict._id) INTO _translation;
		IF _translation._id IS NULL THEN
			CALL translate_new_translation(_dict, _block, _key);
		END IF;
	END LOOP;
END
$$ LANGUAGE plpgsql;

-- Remove translation if no other block is using it
CREATE OR REPLACE PROCEDURE translate_content_delete(_block block) AS $$
DECLARE
	dict_id INTEGER;
	_key TEXT;
	_translation block;
	_count INTEGER;
BEGIN
	SELECT _id FROM translate_find_dictionary(_block._id) INTO dict_id;
	IF dict_id IS NULL THEN
		RETURN;
	END IF;
	FOR _key, _value IN
		SELECT item->>'key', item->>'value' FROM unnest(_block.content) AS item;
	LOOP
		SELECT * FROM translate_find_translation(_block.type, _key, _value, dict_id) INTO _translation;
		IF _translation._id IS NOT NULL THEN
			SELECT count(*) FROM translate_find_blocks(_translation, dict_id) INTO _count;
		ELSE
			_count := 0;
		END IF;
		IF _count = 0 THEN
			DELETE FROM block WHERE _id = _translation._id;
		END IF;
	END LOOP;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_content_delete_func() RETURNS trigger AS $$
BEGIN
	CALL translate_content_delete(OLD);
	RETURN OLD;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_content_insert_func() RETURNS trigger AS $$
BEGIN
	CALL translate_content_insert(NEW);
	RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_content_update_func() RETURNS trigger AS $$
DECLARE
	_dict block;
	_key TEXT;
	_value TEXT;
	_translation block;
	_count INTEGER;
BEGIN
	SELECT * FROM translate_find_dictionary(OLD._id) INTO _dict;
	IF _dict._id IS NULL THEN
		RETURN NEW;
	END IF;
	FOR _key, _value IN
		SELECT item->>'key', item->>'value' FROM unnest(OLD.content) AS item;
	LOOP
		IF _value = block_get_content(NEW.content, _key) THEN
			CONTINUE;
		END IF;
		SELECT * FROM translate_find_translation(OLD.type, _key, _value, _dict._id) INTO _translation;
		IF _translation._id IS NOT NULL THEN
			SELECT count(*) FROM translate_find_blocks(_translation, _dict._id) INTO _count;
		ELSE
			_count := 0;
		END IF;
		IF _count = 0 THEN
			DELETE FROM block WHERE _id = _translation._id;
		END IF;
	END LOOP;
	FOR _key, _value IN
		SELECT item->>'key', item->>'value' FROM unnest(NEW.content) AS item;
	LOOP
		SELECT * FROM translate_find_translation(NEW.type, _key, _value, _dict._id) INTO _translation;
		IF _translation._id IS NULL THEN
			CALL translate_new_translation(_dict, NEW, _key);
		END IF;
	END LOOP;
	RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER translate_content_insert_trigger AFTER INSERT ON block FOR EACH ROW WHEN (NEW.type NOT IN ('translation', 'dictionary') AND array_length(NEW.content, 1) IS NOT NULL EXECUTE FUNCTION translate_content_insert_func();

CREATE OR REPLACE TRIGGER translate_content_update_trigger AFTER UPDATE OF content ON block FOR EACH ROW WHEN (NEW.type NOT IN ('translation', 'dictionary') AND (array_length(OLD.content, 1) IS NOT NULL OR array_length(NEW.content, 1) IS NOT NULL)) EXECUTE FUNCTION translate_content_update_func();

CREATE OR REPLACE TRIGGER translate_content_delete_trigger AFTER DELETE ON block FOR EACH ROW WHEN (OLD.type NOT IN ('translation', 'dictionary') AND array_length(OLD.content, 1)) EXECUTE FUNCTION translate_content_delete_func();

CREATE OR REPLACE FUNCTION translate_update_dictionary_func() RETURNS trigger AS $$
DECLARE
	old_dict TEXT;
	new_dict TEXT;
	dict_id INTEGER;
	_translation block;
	_count INTEGER;
BEGIN
	old_dict := OLD.data->>'dictionary';
	new_dict := NEW.data->>'dictionary';
	IF old_dict IS NOT NULL THEN
		SELECT _id FROM block WHERE id = old_dict AND type = 'dictionary' INTO dict_id;
		FOR _translation IN
			SELECT block.* FROM relation, block WHERE relation.parent_id = dict_id AND block._id = relation.child_id AND block.type = 'translation'
		LOOP
			SELECT count(*) FROM translate_find_blocks(_translation, dict_id) INTO _count;
			IF _count = 0 THEN
				DELETE FROM block WHERE _id = _translation._id;
			END IF;
		END LOOP;
	ELSE
		-- translation triggers in all children of current standalone parent
		UPDATE block SET content = block.content FROM relation WHERE relation.parent_id = NEW._id AND _id = relation.child_id;
	END IF;
	RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER translate_update_dictionary_trigger AFTER UPDATE OF data ON block FOR EACH ROW WHEN (NEW.standalone IS TRUE AND NEW.type NOT IN ('translation', 'dictionary') AND OLD.data->>'dictionary' IS DISTINCT FROM NEW.data->>'dictionary') EXECUTE FUNCTION translate_update_dictionary_func();
