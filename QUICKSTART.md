pageboard user.add \
--data.data.email='your@email.com' \
--data.data.name='John Doe' \
--data.data.nickname=root

pageboard site.add \
--data.data.name=local \
--data.data.domain=localhost \
--data.email='your@email.com'

TODO how to relate user -> site from cli
and also site -> user to make sure the login form works.

pageboard site.save \
--data.domain=localhost \
--data.data.dependencies.@pageboard/elements=pageboard/elements \
--data.data.dependencies.@pageboard/elements-gallery=pageboard/elements-gallery \
--data.data.dependencies.myproject=mygithubrepositoryorg/myproject

also add a github hook in your github project settings, sending application/json payloads to
http://myproject.pageboard.fr/.api/github

How to login the first time, without a login page ?
---------------------------------------------------

Do:
pageboard auth.login --data.email='you@email.com' --data.domain='localhost'
pageboard auth.activate --data.email='you@email.com' --data.domain='localhost'

You obtain a one-time activation link, and just need to prepend your site
hostname to it to build an absolute url.


How to set a user as webmaster for a site ?
-------------------------------------------

pageboard site.own --data.email='you@email.com' --data.domain='localhost'


How to setup login ?
--------------------

This assumes a mail transport has been setup. See pageboard/mail.

On "Page Not Found", insert a sitemap, and two pages in it:

/login
/login/email

On /login, create a form with an input[name="email"] (format email, required)
and the form must be
action: submit auth.login
reaction: submit mail.send, to: res.id, url: /login/email

Then on /login/email, add a Auth Activation button.
That's it !

