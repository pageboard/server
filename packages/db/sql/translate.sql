CREATE OR REPLACE FUNCTION translate_block_content(_block block, _lang TEXT) RETURNS JSONB AS $$
DECLARE
	dict_id INTEGER;
	_target JSONB;
	_translation block;
	_key TEXT;
	_content JSONB;
BEGIN
	SELECT translate_find_dictionary(_block._id) INTO dict_id;
	_content := _block.content;
	FOR _key IN
		SELECT * FROM jsonb_object_keys(_content)
	LOOP
		SELECT * FROM translate_find_translation(_block, _key, dict_id) INTO _translation;
		IF _translation._id IS NOT NULL THEN
			_target := _translation.data['targets'][_lang];
			IF _target IS NOT NULL THEN
				_content := jsonb_set(_content, ARRAY[_key], _target, TRUE);
			END IF;
		END IF;
	END LOOP;
	RETURN _content;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_find_translation(_block block, _key TEXT, dict_id INTEGER) RETURNS block AS $$
DECLARE
	_result block;
BEGIN
	SELECT block.* FROM block, relation
		WHERE relation.parent_id = dict_id
		AND block._id = relation.child_id
		AND block.type = 'translation'
		AND block.data->>'type' = _block.type
		AND block.data->>'content' = _key
		AND block.data['source'] = _block.content[_key]
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
		AND (block.content[_translation.data->>'content'])::text = _translation.data['source'];
	RETURN;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE PROCEDURE translate_new_translation(_block block, _key TEXT, dict_id INTEGER) AS $$
DECLARE
	translation_id INTEGER;
	site_id INTEGER;
	cur_id TEXT;
BEGIN
	SELECT relation.parent_id FROM relation WHERE relation.child_id = dict_id INTO STRICT site_id;

	INSERT INTO block (id, type, data) VALUES (
			replace(gen_random_uuid()::text, '-', ''),
			'translation',
			jsonb_build_object(
				'type', _block.type,
				'content', _key,
				'source', _block.content[_key],
				'targets', '{}'::jsonb
			)
		);
	SELECT currval(pg_get_serial_sequence('block','_id')) INTO translation_id;
	INSERT INTO relation (child_id, parent_id) VALUES (translation_id, site_id);
	INSERT INTO relation (child_id, parent_id) VALUES (translation_id, dict_id);
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION translate_find_dictionary(block_id INTEGER)
	RETURNS INTEGER AS $$
DECLARE
	dict_id INTEGER;
BEGIN
	SELECT dict._id
		FROM relation AS block_parent, block AS parent,
			relation AS block_site, block AS site, relation AS dict_site, block AS dict
		WHERE block_parent.child_id = block_id AND parent._id = block_parent.parent_id AND parent.type != 'site' AND block_site.child_id = block_parent.child_id AND site._id = block_site.parent_id AND site.type = 'site'
		AND dict_site.parent_id = site._id AND dict._id = dict_site.child_id AND dict.type = 'dictionary' AND dict.id = parent.data->>'dictionary'
		INTO dict_id;
	IF FOUND THEN
		RETURN dict_id;
	ELSE
		RETURN -1;
	END IF;
END
$$ LANGUAGE plpgsql;

-- Insert new translation if none is found
CREATE OR REPLACE PROCEDURE translate_content_insert(_block block) AS $$
DECLARE
	dict_id INTEGER;
	_key TEXT;
	_translation block;
BEGIN
	SELECT translate_find_dictionary(_block._id) INTO dict_id;
	IF dict_id < 0 THEN
		RETURN;
	END IF;
	FOR _key IN
		SELECT * FROM jsonb_object_keys(_block.content)
	LOOP
		SELECT * FROM translate_find_translation(_block, _key, dict_id) INTO _translation;
		IF _translation._id IS NULL THEN
			CALL translate_new_translation(_block, _key, dict_id);
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
	SELECT translate_find_dictionary(_block._id) INTO dict_id;
	IF dict_id < 0 THEN
		RETURN;
	END IF;
	FOR _key IN
		SELECT * FROM jsonb_object_keys(_block.content)
	LOOP
		SELECT * FROM translate_find_translation(_block, _key, dict_id) INTO _translation;
		IF _translation._id IS NOT NULL THEN
			SELECT count(*) FROM translate_find_blocks(_translation, dict_id) INTO _count;
		ELSE
			_count := 0;
		END IF;
		IF _count = 0 THEN
			PERFORM DELETE FROM block WHERE _id = _translation._id;
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
	dict_id INTEGER;
	_key TEXT;
	_translation block;
	_count INTEGER;
BEGIN
	SELECT translate_find_dictionary(OLD._id) INTO dict_id;
	IF dict_id < 0 THEN
		RETURN NEW;
	END IF;
	FOR _key IN
		SELECT * FROM jsonb_object_keys(OLD.content)
	LOOP
		IF OLD.content[_key] = NEW.content[_key] THEN
			CONTINUE;
		END IF;
		SELECT * FROM translate_find_translation(OLD, _key, dict_id) INTO _translation;
		IF _translation._id IS NOT NULL THEN
			SELECT count(*) FROM translate_find_blocks(_translation, dict_id) INTO _count;
		ELSE
			_count := 0;
		END IF;
		IF _count = 0 THEN
			PERFORM DELETE FROM block WHERE _id = _translation._id;
		END IF;
	END LOOP;
	FOR _key IN
		SELECT * FROM jsonb_object_keys(NEW.content)
	LOOP
		SELECT * FROM translate_find_translation(NEW, _key, dict_id) INTO _translation;
		IF _translation._id IS NULL THEN
			RAISE NOTICE 'new translation %', NEW.type;
			CALL translate_new_translation(NEW, _key, dict_id);
		ELSE
			RAISE NOTICE 'translation found %', _translation;
		END IF;
	END LOOP;
	RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER translate_content_insert_trigger AFTER INSERT ON block FOR EACH ROW EXECUTE FUNCTION translate_content_insert_func();

CREATE OR REPLACE TRIGGER translate_content_update_trigger AFTER UPDATE OF content ON block FOR EACH ROW EXECUTE FUNCTION translate_content_update_func();

CREATE OR REPLACE TRIGGER translate_content_delete_trigger AFTER DELETE ON block FOR EACH ROW EXECUTE FUNCTION translate_content_delete_func();

CREATE OR REPLACE FUNCTION translate_update_dictionary_func() RETURNS trigger AS $$
DECLARE
	old_dict TEXT;
	new_dict TEXT;
BEGIN
	-- old_dict := OLD.data->>'dictionary';
	-- new_dict := NEW.data->>'dictionary';
	-- all translations in that dictionary must be checked and removed is not used ?

	UPDATE block SET content = block.content FROM relation WHERE relation.parent_id = NEW._id AND _id = relation.child_id;
	RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER translate_update_dictionary_trigger AFTER UPDATE OF data ON block FOR EACH ROW WHEN (OLD.data->>'dictionary' IS DISTINCT FROM NEW.data->>'dictionary') EXECUTE FUNCTION translate_update_dictionary_func();