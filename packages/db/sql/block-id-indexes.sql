-- apply these for a previous pageboard 0.10 (schema.sql already has that index)
-- it is however a bad idea to run pageboard < 0.10 using these
DROP INDEX block_id_index;
CREATE INDEX block_id_index ON block USING btree (id);
CREATE UNIQUE INDEX block_user_site_index ON block USING btree (id) WHERE type::text = ANY (ARRAY['site'::text, 'user'::text]);


-- this enforces child.id, site.id pairs to be unique

CREATE MATERIALIZED VIEW relations_id AS
SELECT child.id AS child_id, parent.id AS parent_id FROM block AS child
LEFT OUTER JOIN relation AS r ON r.child_id = child._id
LEFT OUTER JOIN block AS parent ON parent._id = r.parent_id AND parent.type = 'site';
CREATE UNIQUE INDEX ON relations_id (child_id, parent_id);
