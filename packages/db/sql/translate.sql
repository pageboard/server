CREATE OR REPLACE FUNCTION translate_content(
	_type TEXT, _content JSONB, dictionary_id INTEGER, _lang TEXT
) RETURNS JSONB
  LANGUAGE plpgsql STABLE
	AS $$
DECLARE
	_target TEXT;
	_row RECORD;
BEGIN
	FOR _row IN
		SELECT * FROM jsonb_each_text(_content)
	LOOP
		-- TODO if lang == dictionary.data.source, do not translate
		SELECT block.data['targets'][_lang] INTO _target FROM block, relation
			WHERE relation.parent_id = dictionary_id
			AND block._id = relation.child_id
			AND block.type = 'translation'
			AND block.data['type']::text = _type
			AND block.data['content']::text = _row.key
			AND block.data['source']::text = _row.value;
		IF (FOUND AND _target IS NOT NULL) THEN
			_content = jsonb_set(_content, _row.key, _target);
		END IF;
	END LOOP;
	RETURN _content;
END
$$;

CREATE OR REPLACE FUNCTION translatable_content(
	_type TEXT, _content JSONB, dictionary_id INTEGER, site_id INTEGER
) RETURNS INTEGER
	LANGUAGE plpgsql
	AS $$
DECLARE
	block_id INTEGER;
	_row RECORD;
	_total INTEGER := 0;
BEGIN
	FOR _row IN
		SELECT * FROM jsonb_each_text(_content)
	LOOP
		IF NOT EXISTS (SELECT FROM block, relation
			WHERE relation.parent_id = dictionary_id
			AND block._id = relation.child_id
			AND block.type = 'translation'
			AND block.data['type']::text = _type
			AND block.data['content']::text = _row.key)
		THEN
			INSERT INTO block (id, type, data)
				VALUES (
					replace(gen_random_uuid()::text, '-', ''),
					'translation',
					jsonb_build_object(
						'type', _type,
						'content', _row.key,
						'source', _row.value,
						'targets', '{}'::jsonb
					)
				)
				RETURNING _id INTO block_id;
			INSERT INTO relation (child_id, parent_id) VALUES (block_id, site_id);
			INSERT INTO relation (child_id, parent_id) VALUES (block_id, dictionary_id);
			_total := _total + 1;
		END IF;
	END LOOP;
	RETURN _total;
END
$$;
