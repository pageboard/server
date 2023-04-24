# pageboard-proxy container

## build

First make sure /var/lib/machines/bookworm is available:
```
sudo mkosi --distribution=debian --release=bookworm
```


Then build the overlay image:

```
sudo mkosi
```


## install

Copy these image directories from the build host to the target host:
/var/lib/machines/bookworm
/var/lib/machine/pageboard-proxy

and copy
 /var/lib/machines/pageboard-proxy.nspawn
to the target host
 /etc/systemd/nspawn/


## certificate

Certificates are handled by autossl, but the root domain wildcard certificate needs more work.

For now, manually put the privkey.pem/fullchain.pem files into /var/lib/pageboard/proxy/nginx/ssl/cert/


