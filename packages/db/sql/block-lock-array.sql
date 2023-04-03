UPDATE block SET lock = block.lock['read'] WHERE block.lock['read'] IS NOT NULL;
UPDATE block SET lock = null WHERE lock = '[]' OR lock = '{}';
