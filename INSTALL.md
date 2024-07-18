database
--------

First create a postgres user and database, and on that database:
CREATE EXTENSION unaccent;

pageboard api.migrate

kickstart
---------

Shared configuration, and particularly the shared languages declarations, must be imported twice:

pageboard site.add id=shared
pageboard --site=shared archive.import empty=true file=data/shared.ndjson
pageboard --site=shared site.update languages.0=fr
pageboard --site=shared archive.import empty=true file=data/shared.ndjson

user
----

pageboard user.add \
data.email='your@email.com' \
data.name='John Doe' \
data.nickname=root

site
----

pageboard site.add \
id=<newsiteid> \
data.domain=<fqdn> \
data.module=pageboard/site-semantic-ui

domain, module, env can be changed using site.save.

also add a github hook in your github project settings, sending application/json payloads to
http://myproject.pageboard.io/.well-known/git

How to set a user as webmaster for a site ?
-------------------------------------------

pageboard --site=<id> settings.save data.grants=webmaster email=you@email.com

How to login the first time, without a login page ?
---------------------------------------------------

Complete previous step then

pageboard --site=<id> auth.login grants=webmaster email='you@email.com'

You obtain a one-time activation link, and just need to prepend your site
hostname to it to build an absolute url.


How to setup login ?
--------------------

This assumes a mail transport has been setup. See pageboard/mail.

On "Page Not Found", insert a sitemap, and two pages in it:

/login
/login/email

On /login, create a form with an input[name="email"] (format email, required)
and the form must be
action: submit mail.send, url: /login/email

Then on /login/email, add a Auth Login button.
That's it !

Fine and now how do i call api that is site-dependent ?
-------------------------------------------------------

An example:
```
pageboard --site=mysiteid page.search text=test
```

Loopback setup for multiple domains
-----------------------------------

Create a file /etc/NetworkManager/dnsmasq.d/localdomain.conf containing
address=/localhost.localdomain/127.0.0.1
