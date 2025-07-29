
CREATE TABLE href2 AS (SELECT DISTINCT ON(_parent_id, url) _parent_id, url, mime, type, icon, site, meta, lang, created_at, updated_at, tsv, preview, title, canonical  FROM href ORDER BY url, _parent_id ASC, updated_at DESC);

TRUNCATE TABLE href;

DROP INDEX IF EXISTS href__parent_id_url_lang_idx;
CREATE UNIQUE INDEX href__parent_id_url_idx ON href(_parent_id, url);

INSERT INTO href (_parent_id, url, mime, type, icon, site, meta, lang, created_at, updated_at, tsv, preview, title, canonical) (SELECT * FROM href2);

DROP TABLE href2;
