proxy - server handshake:

- init: holds all requests except proxy handshake
- server replies to proxy and wait some time for proxy to parse response
- server is ready

domain states:

- init: holds all requests
- starts proxy IP checks then continue to created or failed
- created: install domain then continue to installed or failed
- installed: wait request to wk.cache then continue to ready
- ready: let requests go through (and be configured)
- failed: any thrown error put host in that state
        all requests are returned with the same error response

TODO: domain handling is missing in that picture,
and generic hostname (id + suffix) IP check is useless

Change it so that the domain(s) can be set on another site using this procedure:

1. the other site has a host that is registered, installed, and ready
2. siteA.data.domains is removed and copied to siteB.data.domains
3. a cache bust request is made to domain[0], and to A.suffix and B.suffix

Also the idea is to not let a site be reinstalled when it is served by a domain.
To do an installation, a copy of the site must be done, installed, and ready,
then only the above change of domain can happen.

In this setting, checking the correctness of domain/ip can be done when
site.data.domains is saved.

Also site.data.domains is never copied when copying a site.

TODO: proxy can stop getting the list of site id and mappings,
it only has to know the list of domain names to allow.

when the server receives a known id.suffix that maps to a domain,
it just has to redirect to that domain.

When the server receives an unknown id.suffix, it just has to
send a 410 with a 1 minute cache.

