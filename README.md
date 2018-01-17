database
--------

First create a postgres user and database, and on that database:
CREATE EXTENSION unaccent;

pageboard api.migrate

To restore an existing pageboard dump:
pg_restore -c -d pageboard pageboard-20180117T020001.dump

user
----

pageboard user.add \
data.email='your@email.com' \
data.name='John Doe' \
data.nickname=root

site
----

pageboard site.add \
data.name=local \
data.domain=localhost \
email='your@email.com'

TODO how to relate user -> site from cli
and also site -> user to make sure the login form works.

pageboard site.save \
domain=localhost \
data.dependencies.@pageboard/elements=pageboard/elements \
data.dependencies.@pageboard/elements-gallery=pageboard/elements-gallery \
data.dependencies.myproject=mygithubrepositoryorg/myproject

also add a github hook in your github project settings, sending application/json payloads to
http://myproject.pageboard.fr/.api/github

How to login the first time, without a login page ?
---------------------------------------------------

Do:
pageboard auth.login email='you@email.com' domain='localhost'

You obtain a one-time activation link, and just need to prepend your site
hostname to it to build an absolute url.


How to set a user as webmaster for a site ?
-------------------------------------------

pageboard site.own email='you@email.com' domain='localhost'


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

