CREATE OR REPLACE FUNCTION translate_content(
	type TEXT, content JSONB, dictionary_id INTEGER, lang TEXT
) RETURNS JSONB
  LANGUAGE plpgsql STABLE
	AS $$
DECLARE
	dest TEXT;
	row RECORD;
BEGIN
	FOR row IN
		SELECT jsonb_each_text(content)
	LOOP
		SELECT block.data['targets'][lang] INTO dest FROM block, relation
			WHERE relation.parent_id = dictionary_id
			AND block._id = relation.child_id
			AND block.type = 'translation'
			AND block.data['type'] = type
			AND block.data['content'] = row.key
			AND block.data['source'] = row.value;
		IF (FOUND AND dest IS NOT NULL) THEN
			content = jsonb_set(content, row.key, dest);
		END IF;
	END LOOP;
	RETURN content;
END
$$;

CREATE OR REPLACE FUNCTION translatable_content(
	type TEXT, content JSONB, dictionary_id INTEGER, site_id INTEGER
) RETURNS INTEGER
	LANGUAGE plpgsql
	AS $$
DECLARE
	dest RECORD;
	block_id INTEGER;
	row RECORD;
	count INTEGER := 0;
BEGIN
	FOR row IN
		SELECT jsonb_each_text(content)
	LOOP
		IF NOT EXISTS (SELECT FROM block, relation
			WHERE relation.parent_id = dictionary_id
			AND block._id = relation.child_id
			AND block.type = 'translation'
			AND block.data['type'] = type
			AND block.data['content'] = row.key)
		THEN
			INSERT INTO block (type, data)
				VALUES ('translation', json_build_object('type', type, 'content', row.key, 'source', row.value, 'targets', '{}')::jsonb)
				RETURNING _id INTO block_id;
			INSERT INTO relation (child_id, parent_id) VALUES (block._id, site_id);
			INSERT INTO relation (child_id, parent_id) VALUES (block._id, dictionary_id);
			count := count + 1;
		END IF;
	END LOOP;
	RETURN count;
END
$$;
