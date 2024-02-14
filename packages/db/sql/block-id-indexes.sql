-- apply these for a previous pageboard 0.10 (schema.sql already has that index)
-- it is however a bad idea to run pageboard < 0.10 using these
DROP INDEX block_id_index;
CREATE INDEX block_id_index ON block USING btree (id);
CREATE UNIQUE INDEX block_user_site_index ON block USING btree (id) WHERE type::text = ANY (ARRAY['site'::text, 'user'::text]);


-- force siblings to have a unique id

CREATE OR REPLACE FUNCTION siblings_unique_id() RETURNS trigger
	LANGUAGE plpgsql
AS $BODY$
DECLARE
	site_id TEXT;
	block_id TEXT;
BEGIN
	SELECT parent.id, block.id INTO site_id, block_id
	FROM block, block AS child, block AS parent, relation
	WHERE block._id = new.child_id
		AND parent._id = new.parent_id
		AND parent.type = 'site'
		AND relation.parent_id = new.parent_id
		AND relation.child_id != new.child_id
		AND child._id = relation.child_id
		AND child.id = block.id;
	IF FOUND THEN
		RAISE EXCEPTION 'block.id: % must be unique in site: %', block_id, site_id;
	END IF;
	RETURN new;
END
$BODY$;

CREATE OR REPLACE TRIGGER siblings_unique_id_trigger BEFORE INSERT ON relation FOR EACH ROW EXECUTE FUNCTION siblings_unique_id();
