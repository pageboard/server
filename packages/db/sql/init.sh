#!/bin/sh

db="${1}"
role="${2}"

psql --command "CREATE DATABASE ${db}"

psql --dbname "${db}" \
--command 'ALTER DATABASE pageboard SET search_path = "$user", public, extensions' \
--command "CREATE SCHEMA extensions" \
--command "GRANT USAGE ON SCHEMA extensions TO ${role}" \
--command 'CREATE EXTENSION "pg_trgm" WITH SCHEMA extensions' \
--command 'CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions' \
--command 'CREATE EXTENSION "unaccent" WITH SCHEMA extensions' \
--command 'CREATE TEXT SEARCH CONFIGURATION extensions.unaccent ( COPY = simple )' \
--command 'ALTER TEXT SEARCH CONFIGURATION extensions.unaccent ALTER MAPPING FOR hword, hword_part, word WITH extensions.unaccent, simple' \
--command 'CREATE TEXT SEARCH CONFIGURATION fr_unaccent ( COPY = french )' \
--command 'ALTER TEXT SEARCH CONFIGURATION fr_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem' \
--command 'CREATE TEXT SEARCH CONFIGURATION en_unaccent ( COPY = english )' \
--command 'ALTER TEXT SEARCH CONFIGURATION en_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, english_stem'
