DROP INDEX IF EXISTS block_expr_lang_idx;
CREATE INDEX block_url_index ON block(((data->'url')::text));
