pageboard
=========

routage
-------

Il y a trois grands types de routes

- les fichiers locaux (montés sur /media, /js, /css, ...)
- l'API (montée sur /api)
- les pages (montées sur /)

Les pages sont toutes construites à l'aide d'un fichier html "front.html",
qui décide quoi faire en cas d'erreur (redirection par document.location
par exemple).


base de données
---------------

Le contenu du site est géré par une seule table en relation n,n avec elle-même,
la table de "blocs":

type: le type sémantique (obligatoire)
mime: le type réel (obligatoire)
url: l'url publique du bloc
lang: langue ISO 639-1
scopes: permissions au format jwt-scopes
data: attributs du bloc
html: contenu html du bloc


D'autres tables plus spécialisées peuvent être ajoutés bien sûr; par exemple
l'administration du site a besoin d'une gestion des utilisateurs et des permissions.


composants
----------

Un composant est utilisé pour typer les blocs et les rendre éditables.

Ce qui est abordé ici est un résumé de la documentation du module `coed`.

Un composant définit:
- des noms d'attributs
- des noms de contenus
- un schéma par nom de contenu
- un nom de composant

Les attributs servent à construire une représentation DOM du composant lors
de son édition ou lors de sa publication.

Les contenus sont produits par l'éditeur html, dans un schéma qui leur est imposé.

Un composant a aussi des fonctions permettant de parser ou serialiser du DOM.
Ce DOM peut être dans trois formats: d'entrée, d'édition et de sortie.

- from(domNode avec les attributs content-name) -> attrs
- to(attrs) -> domNode avec les attributs content-name
Le format d'édition doit pouvoir être parsé en attributs json et en contenus html,
et vice-versa. Le contenu html étant systématiquement repéré par un attribut
"content-name", le module s'occupe de lire et écrire leur contenu, et ces
fonctions n'ont besoin de s'occuper que de la fusion ou de la lecture des attributs,
ainsi que le placement des attributs "content-name".

- input(domNode) -> {attrs, contents}
La conversion depuis le format d'entrée est optionnelle et permet de convertir
une saisie utilisateur en attributs et contenus qui seront ensuite rendus au
format édition.

- output(attrs, contents) -> domNode
La conversion vers le format de sortie est optionnelle et permet de convertir
le format d'édition vers un format plus approprié pour l'affichage en front.
Dans le cadre d'un CMS, les attributs utiles à l'édition mais inutiles en front
sont référencés à l'aide d'un attribut sur le domNode et la fonction d'input
peut par la suite utiliser cette référence pour retrouver les attributs - le
contenu étant porté par le domNode au format de sortie et pouvant être identifié
par un attribut du même genre que "content-name" (mais qui ne sera lu que par
la fonction d'input et n'est donc pas imposé par le module).

Si `input` n'est pas précisée pour un composant, l'import depuis la saisie s
limite au format reconnu par `from`, et si `output` n'est pas précisée, l'export
se limite au format produit par `to`.


format de sortie des composants
-------------------------------

Ce qui est maintenant abordé est hors de la documentation du module `coed`,
et sont des conventions propres à `pageboard`.

Dans `pageboard`, les blocs enregistrent dans le champ `html` la *sortie* produite
par les composants. Ces derniers doivent donc être capables de retrouver tous
les attributs associés à une instance de composant, et les fonctions `input` et
`output` doivent respecter des conventions.

- output doit étiquetter les contenus avec un attribut `pb-name`, et placer
un attribut `pb-id` sur le DOM de sortie avec comme valeur l'url du bloc dans
l'api. Ceci permet de facilement imbriquer des blocs.
- une fonction d'input par défaut est configurée dans `coed` pour reconnaitre le
format de sortie décrit précédemment


références de composants
------------------------

Un bloc peut, au lieu de contenir le html d'un autre bloc dans un de ses contenus,
ne contenir qu'une référence vers cet autre bloc, en lui ajoutant un attribut
booléen `pb-ref` à côté de l'attribut `pb-id`.

En plus du comportement habituel dicté par `pb-id`, `pb-ref` indique
- à la fonction d'affichage du DOM (qui prend la sortie de l'éditeur comme entrée)
qu'il faut remplacer ce node par le html du bloc référencé par `pb-id`
- à l'éditeur html qu'il doit recopier l'attribut `pb-ref` et ne pas écrire
le contenu du node dans la sortie; et éventuellement signaler dans l'UI que
ce bloc est une référence
- que pour modifier le html portant un pb-ref, il faut ouvrir l'éditeur sur
le bloc référencé.


web components
--------------

Il est possible qu'un bloc soit à la fois une instance de composant (forcément),
et une instance de web component.

Il serait tentant d'éditer directement les blocs à partir du DOM rendu, mais
d'une manière générale on ne sait pas quelles transformations ont pu modifier
le contenu, et en particulier dans le cas des web components on sait que
ce qui est affiché ne correspond pas à ce qui a été initialement inséré.

Lors de l'édition, on travaille donc à partir de l'original du html qui est
enregistré dans le bloc, pas avec sa version "rendue" dans le DOM.


dépendances
-----------

construction d'une page
-----------------------

gestion des références
----------------------

gestion des pages
-----------------

