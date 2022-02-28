CREATE SCHEMA extensions;
ALTER DATABASE pageboard SET search_path = "$user", public, extensions;
ALTER EXTENSION "pg_trgm" SET SCHEMA extensions;
ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions;
ALTER EXTENSION "unaccent" SET SCHEMA extensions;
ALTER TEXT SEARCH CONFIGURATION "unaccent" SET SCHEMA extensions;
