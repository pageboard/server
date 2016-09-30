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

```
type: le type sémantique (obligatoire)
mime: le type réel (obligatoire)
url: l'url publique du bloc
lang: langue ISO 639-1
scopes: permissions au format jwt-scopes
data: attributs du bloc
html: contenu html du bloc
```

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


validation de bloc par composant
--------------------------------

La définition d'un composant peut être chargée dans l'API afin de permettre la
validation:

- de bloc.data par les définitions des attributs d'un composant
- de bloc.html par les définitions de schéma de contenu

Validation des attributs:
définir le schéma des attributs dans le composant, en utilisant json-schema,
et valider avec `ajv`.
On pourra essayer d'améliorer le niveau de validation dans l'éditeur de texte,
qui pour l'instant ne fait que vérifier l'absence ou la présence d'attributs.

Validation du html:
si le client n'envoie que du html au serveur, il va falloir trouver ou développer
un TreeAdapter pour `parse5` qui n'expose que DOM Level 1 Core, et passer
le document obtenu au parseur de prosemirror.

Une autre solution un peu moins complexe et d'envoyer aussi le json correspondant
au html - dans ce cas le json peut être plus facilement validé par prosemirror
sur le serveur, et il suffit ensuite de reconstruire le html à partir du json
et vérifier qu'on obtient bien la même chose.

Dans ce cas on peut se demander si on veut conserver dans la base de données
le html ou le json - mais le défaut du format json est qu'il doit être resérialisé
à chaque fois, contrairement au format html qui peut être utilisé tel quel.


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
et une instance de web component. Il ne faut cependant pas confondre les deux:
un composant est une classe définie et utilisée pour l'édition des blocs,
un web component est défini et utilisé pour le rendu du DOM.

Il serait tentant d'éditer directement les blocs à partir du DOM rendu, mais
d'une manière générale on ne sait pas quelles transformations ont pu modifier
le contenu, et en particulier dans le cas des web components on sait que
ce qui est affiché ne correspond pas à ce qui a été initialement inséré.

Lors de l'édition, on travaille donc à partir de l'original du html qui est
enregistré dans le bloc, pas avec sa version "rendue" dans le DOM.


rendu des blocs
---------------

L'API permet d'obtenir un bloc et l'arbre des relations avec ses sous-blocs,
en une seule requête.

Le html du bloc racine est parsé, et chaque fois qu'un attribut `pb-ref` est
trouvé, la valeur de `pb-id` correspondante est cherchée dans une map id->bloc
construite à partir de l'arbre des sous-blocs, le bloc correspondant est trouvé
et remplace le Node qui servait de référence.

Lors de ce remplacement on peut considérer qu'on conserve les attributs qui
étaient placés sur le node qui a été remplacé, dans la mesure où l'éditeur
gère cette possibilité - à implémenter en fonction des besoins, l'exemple
typique étant de conserver une "classe" css sur le Node porteur de `pb-ref`,
et de conserver cette classe dans le Node qui remplace la référence.

Remarque pour une version qui fonctionnerait "offline":
Dans une architecture où la base de données serait accessible par un proxy sur
le client qui saurait maintenir un cache correctement, les données obtenues
initialement par l'API pourraient peupler le cache du client, et le remplacement
des blocs se ferait en requêtant le proxy qui répondrait immédiatement, ayant
les données des sous-blocs en cache. Si un sous-bloc n'était pas en cache,
il serait alors requêté à l'API.


pages
-----

Une page est un bloc identifié par un type "page" et un mime type "text/html".
Il faut que l'url du bloc identifié comme étant une page soit accessible par
routage, mais c'est au CMS de faire attention à cela.

Par exemple, si l'url est un chemin /webcomponents/mapage.html et que le contenu
du dossier `webcomponents` est servi comme des fichiers statiques, ce bloc ne
sera pas prérendu mais sera visible comme une page dans le CMS. Dans ce cas le
CMS aurait plutôt dû donner un type "component" ou autre, mais pas "page".

Un bloc de type page possède un attribut "template" qui précise quel fichier
html statique définit les dépendances de la page (attribut stocké dans data.template).
Ce "template" contient le document html avec un tag head et ses dépendances,
et un tag body vide.

Le html du bloc page remplace le contenu du body de ce template.

Cette version de pageboard ne sait pas "gérer" la compilation de dépendances
dynamiques - mais n'empêche pas le chargement de dépendances par un bloc.


spécialisation
--------------

Il peut arriver qu'on veuille utiliser `pageboard` dans un cadre plus précis
que le cadre général d'un CMS.

Dans le liveactu on a ces particularités:

- les composants représentent des ressources ou des articles
- les pages doivent pouvoir être exportées en json
- les articles doivent être tous liés aux pages
- le contenu des articles (aside, content, title) doit pouvoir être exporté en json
- les ressources utilisées dans les articles implémentent une forme de custom elements
avec du lazy loading

Toutes ces particularités entrent dans le cadre de pageboard car ce sont de
simples restrictions, à l'exception des contenus des articles (en tant que blocs,
leurs contenus seraient enregistrés ensemble de le html du bloc) qui doivent
être enregistrés en dehors du html du bloc.

