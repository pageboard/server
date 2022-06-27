-- apply these for a previous pageboard 0.10 (schema.sql already has that index)
-- it is however a bad idea to run pageboard < 0.10 using these
DROP INDEX block_id_index;
CREATE INDEX block_id_index ON block USING btree (id);
CREATE UNIQUE INDEX block_user_site_index ON block USING btree (id) WHERE type::text = ANY (ARRAY['site'::text, 'user'::text]);
