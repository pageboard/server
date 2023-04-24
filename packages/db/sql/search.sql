-- TODO
-- tsv concatenates search vectors of all content + some data
-- this is bad for translations, and also it mixes all kinds of contents in one search

-- instead, add a new column block.tsv::jsonb and update plpgsql functions to keep search vectors for each content key
-- also, we need plpgsql functions to search and return headlines
-- search('text', in_block_types, lang)

-- in_block_types could be a list of types that are known to have text content
-- indeed, most blocks have only placeholders.

-- the reasons we had page.data.title and page.data.description:
-- 1. editable in semafor which ignores completely content (fixable)
-- 2. ???

-- PROBLEM: tsvector cannot be wrapped inside a jsonb
-- SOLUTION: tsv is an array of tsvector
-- block.content is an array of content, both arrays MUST be in the same order
-- block.tsv = ARRAY[tsv1::jsonb, tsv2::jsonb]
-- block.content = ARRAY[content1::jsonb, content2::jsonb]


-- site lang is default dictionary lang - actually site is a dictionary ?
-- or simpler: no translations are created when dictionary has no target languages
-- however setting a default dictionary means always keeping translations
-- around, and currently we duplicate them block.content[0] <-> translation.data.source
-- simply declare a relation between each block.content and a translation
-- break that relation when a block.content[i] changes, and remove translation when relation count to that translation is zero
-- standalone dictionary -> standalone translation -> block
-- it might need a archive.export fix, otherwise it's okay ?
-- update content -> find dicti -> update search tsvector[] with that lang
-- -> update translations -> update search tsvector[] of translation, with lang matching dictionary

-- TODO text search must first use pg_trgm to match searched words against lexemes,
-- and then full text search can be used against those matches ?

-- TODO 1, n relations are not automatically fetched

-- DICTIONARY -- PARENT -- BLOCK -- RELATION -- TRANSLATION-EN, TRANSLATION-IT -- RELATION -- DICTIONARY


DROP TRIGGER block_tsv_trigger ON block;
DROP FUNCTION block_tsv_update();
ALTER TABLE block DROP COLUMN IF EXISTS tsv;
ALTER TABLE block ADD COLUMN search tsvector[];

CREATE OR REPLACE FUNCTION block_search_update_func() RETURNS trigger AS $$
DECLARE
	_language language;
	_tsv tsvector[];
BEGIN
	IF array_length(NEW.content, 1) IS NULL THEN
		NEW.search := NULL;
		RETURN NEW;
	END IF;
	SELECT translate_find_language(source) FROM translate_find_dictionary(NEW._id)
		INTO _language;
	NEW.search := array_agg(to_tsvector(_language.tsconfig, item.value)) FROM unnest(NEW.content) AS item;
 RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER block_search_trigger AFTER UPDATE OF content ON block FOR EACH ROW WHEN (OLD.content IS DISTINCT FROM NEW.content) EXECUTE FUNCTION block_search_update_func();

-- TODO make sure that index is actually used
CREATE INDEX block_search_gin ON block USING gin(search);
