DROP TRIGGER block_tsv_trigger ON block;
DROP FUNCTION block_tsv_update();

CREATE OR REPLACE FUNCTION block_site(block_id INTEGER) RETURNS SETOF block AS $$
BEGIN
	RETURN QUERY SELECT block.* FROM relation, block WHERE relation.child_id = block_id AND block._id = relation.parent_id AND block.type = 'site' LIMIT 1;
	RETURN;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION block_find(_site_id INTEGER, _type TEXT, _path TEXT, _value TEXT) RETURNS block AS $$
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION block_insert(_type TEXT, data JSONB) RETURNS block AS $$
DECLARE
	_block block;
BEGIN
	INSERT INTO block (id, standalone, type, data) VALUES (
		replace(gen_random_uuid()::text, '-', ''), TRUE, _type, data
	) RETURNING block.* INTO _block;
	RETURN _block;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION content_tsv_func() RETURNS trigger AS $$
DECLARE
	_tsconfig regconfig;
	_site block;
BEGIN
	SELECT data->>'tsconfig' INTO _tsconfig
		FROM block WHERE type='language' AND data @@ FORMAT('$.lang == %s', NEW.data->'lang')::jsonpath;

	NEW.tsv := to_tsvector(_tsconfig::regconfig, NEW.data->>'text');
	RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER content_tsv_trigger_insert BEFORE INSERT ON block FOR EACH ROW WHEN (NEW.type = 'content') EXECUTE FUNCTION content_tsv_func();
CREATE OR REPLACE TRIGGER content_tsv_trigger_update BEFORE UPDATE OF data ON block FOR EACH ROW WHEN (NEW.type = 'content' AND NEW.data['text'] != OLD.data['text']) EXECUTE FUNCTION content_tsv_func();


CREATE OR REPLACE FUNCTION block_get_content(block_id INTEGER, _lang TEXT) RETURNS JSONB AS $$
DECLARE
	_obj JSONB;
BEGIN
	SELECT jsonb_object(array_agg(content.name), array_agg(content.text)) INTO _obj
	FROM (
		SELECT block.data->>'name' AS name, block.data->>'text' AS text
		FROM relation AS r, block
		WHERE r.parent_id = block_id AND block._id = r.child_id
		AND block.type = 'content' AND block.data @@ FORMAT('$.lang == %s', to_json(_lang))::jsonpath
	) AS content;
	RETURN _obj;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION block_set_content(block_id INTEGER, _lang TEXT, _obj JSONB) RETURNS JSONB AS $$
DECLARE
	_site block;
	content_ids JSONB;
	cur_id INTEGER;
	cur_lang TEXT;
	cur_ids INTEGER[];
	_name TEXT;
	_text TEXT;
BEGIN
	_site := block_site(block_id);
	-- int[text][] map of old block contents
	SELECT jsonb_object_agg(name, ids) INTO content_ids
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
		END IF;
		-- find if some content already exists for a block in that site
		SELECT other._id INTO cur_id
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
		cur_ids := ARRAY[]::INTEGER[];
		IF cur_id IS NOT NULL THEN
			-- some content is found
			IF cur_id = block_id THEN
				-- itself, nothing to do, will not unlink that content
				content_ids := content_ids - _name;
				CONTINUE;
			ELSE
				-- list of ids to link to block
				SELECT array_agg(content._id) INTO cur_ids
				FROM relation AS r, block AS content
					WHERE r.parent_id = cur_id AND content._id = r.child_id
					AND content.type = 'content'
					AND content.data @@ FORMAT('$.name == %s', to_json(_name))::jsonpath;
			END IF;
		ELSE
			-- need to add new content in every language
			FOR cur_lang IN
				SELECT * FROM jsonb_array_elements_text(_site.data['languages'])
			LOOP
				INSERT INTO block (id, type, data) VALUES (
					replace(gen_random_uuid()::text, '-', ''),
					'content',
					jsonb_build_object(
						'name', _name,
						'lang', cur_lang,
						'text', (CASE WHEN (_lang = cur_lang) THEN _text ELSE '' END)
					)
				) RETURNING block._id INTO cur_id;
				-- relate content to its site
				INSERT INTO relation (child_id, parent_id) VALUES (cur_id, _site._id);
				cur_ids := array_append(cur_ids, cur_id);
			END LOOP;
		END IF;
		-- relate block to its new contents cur_ids
		INSERT INTO relation (child_id, parent_id) (
			SELECT unnest(cur_ids) AS child_id, block_id AS parent_id
		);
	END LOOP;

	FOR _name IN
		SELECT jsonb_object_keys(content_ids)
	LOOP
		-- convert jsonb to int[]
		SELECT array_agg(value)::int[] INTO cur_ids
			FROM jsonb_array_elements(content_ids[_name]);
		-- unrelate
		DELETE FROM relation WHERE child_id = ANY(cur_ids) AND parent_id = block_id;
		-- delete orphaned content
		DELETE FROM block WHERE _id = ANY(cur_ids) AND NOT EXISTS (
			SELECT FROM relation WHERE child_id = block._id AND parent_id != _site._id
		);
	END LOOP;
	RETURN _obj;
END
$$ LANGUAGE plpgsql;

