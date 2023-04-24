
UPDATE block SET lock = block.lock['read'] WHERE block.lock['read'] IS NOT NULL;
UPDATE block SET lock = block.lock['write'] WHERE block.lock['write'] IS NOT NULL;
UPDATE block SET lock = NULL WHERE lock = '[]' OR lock = '{}' OR lock = 'null';

ALTER TABLE block RENAME COLUMN lock TO jlock;
ALTER TABLE block ADD COLUMN lock TEXT[];
UPDATE block SET lock = ARRAY(SELECT jsonb_array_elements_text(jlock)) WHERE jlock IS NOT NULL;
ALTER TABLE block DROP COLUMN jlock;
