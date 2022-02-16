# db

postgresql >= 13, with pg_trgm, uuid-ossp, unaccent extensions.

- create the database as superuser, as shown below
- configure database.url.current in `~/.config/pageboard/config`

## configuration

```toml
[database.url]
current = "postgres://pageboard@localhost/pageboard"
monday = "postgres://pageboard@localhost:5532/pageboard_monday"
```

## create

```sh
sudo -u postgres ./packages/db/sql/init.sh $db $role
```

## dump

```sh
pageboard db.dump file=db.dump
```

## restore

```sh
pageboard db.restore file=db.dump tenant=monday
```
