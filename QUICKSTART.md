pageboard user.add \
--data.data.email='root@localhost.localdomain' \
--data.data.password='password' \
--data.data.name='John Doe' \
--data.data.nickname=root

pageboard site.add \
--data.data.name=myproject
--data.data.domain='myproject.pageboard.fr'
--data.user='root@localhost.localdomain'

pageboard site.save \
--data.domain=myproject.pageboard.fr \
--data.data.dependencies.@pageboard/elements=pageboard/elements \
--data.data.dependencies.@pageboard/elements-carousel=pageboard/elements-carousel \
--data.data.dependencies.@pageboard/elements-portfolio=pageboard/elements-portfolio \
--data.data.dependencies.myproject=mygithubrepositoryorg/myproject

also add a github hook in your github project settings, sending application/json payloads to
http://myproject.pageboard.fr/.api/github

