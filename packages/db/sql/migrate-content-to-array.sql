BEGIN;

ALTER TABLE block ADD COLUMN contentarray JSONB[];

UPDATE block SET (contentarray) = (
	SELECT array_agg(ret.obj::jsonb) AS contentarray FROM (
		SELECT row_to_json(jsonb_each_text(sub.content)) AS obj FROM block AS sub WHERE sub._id = block._id
	) AS ret
);

ALTER TABLE block RENAME COLUMN content TO oldcont;
ALTER TABLE block RENAME COLUMN contentarray TO content;

ALTER TABLE block DROP COLUMN oldcont;

COMMIT;


CREATE OR REPLACE FUNCTION block_get_content(_content JSONB[], _key TEXT) RETURNS TEXT AS $$
DECLARE
	_value TEXT;
BEGIN
	SELECT item->>'value' FROM unnest(_content) AS item WHERE item->>'key' = _key INTO _value;
	RETURN _value;
END;
$$ LANGUAGE plpgsql;

