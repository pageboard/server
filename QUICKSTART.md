pageboard user.add \
--data.data.email='your@email.com' \
--data.data.name='John Doe' \
--data.data.nickname=root

pageboard site.add \
--data.data.name=local \
--data.data.domain=localhost \
--data.user='your@email.com'

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

