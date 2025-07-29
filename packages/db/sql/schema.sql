CREATE FUNCTION href_tsv_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 new.tsv := setweight(to_tsvector('unaccent', coalesce(new.title, '')), 'A') ||
  setweight(to_tsvector('unaccent', href_tsv_url(new.url)), 'A') ||
  setweight(to_tsvector('unaccent', coalesce(new.site, '')), 'B') ||
  setweight(to_tsvector('unaccent', coalesce(new.meta->>'description', '')), 'C')
  ;
 RETURN new;
END
$$;
ALTER FUNCTION href_tsv_update();

CREATE FUNCTION href_tsv_url(url text) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
 RETURN replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/', ' ');
END
$$;
ALTER FUNCTION href_tsv_url(url text);

CREATE FUNCTION jsonb_set_recursive(data jsonb, path text[], new_value jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
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
$$;
ALTER FUNCTION jsonb_set_recursive(data jsonb, path text[], new_value jsonb);

DROP FUNCTION IF EXISTS recursive_delete;
CREATE OR REPLACE FUNCTION recursive_delete(
    root_id integer,
    standalones TEXT[]
) RETURNS INTEGER
  LANGUAGE 'sql'
AS $BODY$
    WITH RECURSIVE children(_id, parent_id, level) AS (
        SELECT b._id, 0 AS parent_id, 0 AS level
        FROM block AS b
        WHERE b._id = root_id
        UNION ALL
        SELECT b._id, r.parent_id, level + 1 AS level
        FROM children, relation AS r, block AS b
        WHERE r.parent_id = children._id AND b._id = r.child_id AND (b.standalone IS FALSE OR b.type = ANY(standalones)) AND b.type != 'content'
    ),
    dels AS (
        DELETE FROM block WHERE _id IN (SELECT _id FROM children ORDER BY level DESC) RETURNING _id
    ) SELECT count(*) FROM dels;
$BODY$;

CREATE TABLE block (
    _id integer NOT NULL,
    id character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    lang character varying(255),
    standalone boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    locks jsonb,
    expr jsonb,
    lock jsonb
);
ALTER TABLE block;

CREATE SEQUENCE block__id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER TABLE block__id_seq;

ALTER SEQUENCE block__id_seq OWNED BY block._id;
CREATE TABLE href (
    _id integer NOT NULL,
    _parent_id integer NOT NULL,
    url character varying(2047) NOT NULL,
    mime character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    icon character varying(255),
    site character varying(255),
    pathname character varying(2047) NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    lang character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tsv tsvector,
    preview text,
    title text NOT NULL,
    canonical character varying(2047)
);
ALTER TABLE href;

CREATE SEQUENCE href__id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER TABLE href__id_seq;

ALTER SEQUENCE href__id_seq OWNED BY href._id;

CREATE TABLE relation (
    id integer NOT NULL,
    parent_id integer NOT NULL,
    child_id integer NOT NULL
);
ALTER TABLE relation;

CREATE SEQUENCE relation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER TABLE relation_id_seq;

ALTER SEQUENCE relation_id_seq OWNED BY relation.id;
ALTER TABLE ONLY block ALTER COLUMN _id SET DEFAULT nextval('block__id_seq'::regclass);
ALTER TABLE ONLY href ALTER COLUMN _id SET DEFAULT nextval('href__id_seq'::regclass);
ALTER TABLE ONLY relation ALTER COLUMN id SET DEFAULT nextval('relation_id_seq'::regclass);
ALTER TABLE ONLY block
    ADD CONSTRAINT block_pkey PRIMARY KEY (_id);
ALTER TABLE ONLY href
    ADD CONSTRAINT href_pkey PRIMARY KEY (_id);
ALTER TABLE ONLY relation
    ADD CONSTRAINT relation_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX block_expr_domain_idx ON block USING btree (((data #>> '{domain}'::text[]))) WHERE ((type)::text = 'site'::text);
CREATE UNIQUE INDEX block_expr_email_idx ON block USING btree (((data #>> '{email}'::text[]))) WHERE ((type)::text = 'user'::text);

CREATE INDEX block_url_index ON block(((data->'url')::text));

CREATE UNIQUE INDEX block_user_site_index ON block USING btree (id) WHERE type::text = ANY (ARRAY['site'::text, 'user'::text]);
CREATE INDEX block_id_index ON block USING btree (id);
CREATE INDEX block_data_idx ON block USING gin (data);
CREATE INDEX block__id_type_idx ON block USING btree (_id, type);
CREATE INDEX block_type_index ON block USING btree (type);
CREATE INDEX block_updated_at_idx ON block USING btree (updated_at DESC);

CREATE INDEX href_mime_index ON href USING btree (mime);
CREATE INDEX href_updated_at_idx ON href USING btree (updated_at DESC);
CREATE UNIQUE INDEX href__parent_id_url_idx ON href(_parent_id, url);
CREATE INDEX index_href_tsv ON href USING gin (tsv);
CREATE INDEX relation_child_id_index ON relation USING btree (child_id);
CREATE UNIQUE INDEX relation_parent_id_child_id_idx ON relation USING btree (parent_id, child_id);
CREATE INDEX relation_parent_id_index ON relation USING btree (parent_id);
CREATE TRIGGER href_tsv_trigger BEFORE INSERT OR UPDATE ON href FOR EACH ROW EXECUTE FUNCTION href_tsv_update();
ALTER TABLE ONLY href
    ADD CONSTRAINT href__parent_id_foreign FOREIGN KEY (_parent_id) REFERENCES block(_id) ON DELETE CASCADE;
ALTER TABLE ONLY relation
    ADD CONSTRAINT relation_child_id_foreign FOREIGN KEY (child_id) REFERENCES block(_id) ON DELETE CASCADE;
ALTER TABLE ONLY relation
    ADD CONSTRAINT relation_parent_id_foreign FOREIGN KEY (parent_id) REFERENCES block(_id) ON DELETE CASCADE;

CREATE MATERIALIZED VIEW relations_id AS
    SELECT child.id AS child_id, parent.id AS parent_id FROM block AS child LEFT OUTER JOIN relation AS r ON r.child_id = child._id LEFT OUTER JOIN block AS parent ON parent._id = r.parent_id AND parent.type = 'site';
CREATE UNIQUE INDEX ON relations_id (child_id, parent_id);
