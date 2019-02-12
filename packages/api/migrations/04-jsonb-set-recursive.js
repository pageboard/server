exports.up = function(knex) {
	return knex.schema
	.raw(`CREATE OR REPLACE FUNCTION jsonb_set_recursive(data jsonb, path text[], new_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS
$$
DECLARE
	chk_path text[];
	cur_path text[];
	cur_idx text;
	cur_value jsonb;
	def_obj jsonb default '{}'::jsonb;
BEGIN
	chk_path := path[:array_length(path, 1) - 1];
	IF (data IS NULL) THEN
		data = '{}'::jsonb;
	END IF;
	IF (data #> chk_path = 'null'::jsonb) THEN
		data = jsonb_set(data, chk_path, def_obj);
	ELSEIF (data #> chk_path IS NULL) THEN  -- fast check
		FOREACH cur_idx IN ARRAY chk_path
		LOOP
			cur_path := cur_path || cur_idx;
			cur_value = data #> cur_path;
			IF (cur_value IS NULL OR cur_value = 'null'::jsonb) THEN
				data = jsonb_set(data, cur_path, def_obj);
			ELSIF (jsonb_typeof(cur_value) NOT IN ('object', 'array')) THEN
				RAISE EXCEPTION 'path element by % is neither object
nor array', cur_path;
			END IF;
		END LOOP;
	ELSIF (jsonb_typeof(data #> chk_path) NOT IN ('object', 'array')) THEN
		RAISE EXCEPTION 'path element by % is neither object nor
array', chk_path;
	END IF;
	RETURN jsonb_set(data, path, new_value);
END
$$
STABLE;`);
};

exports.down = function(knex) {
	return knex.schema
	.raw("DROP FUNCTION IF EXISTS jsonb_set_recursive(jsonb, text[], jsonb)");
};

