pageboard
=========

routage
-------

Il y a trois grands types de routes

- les fichiers locaux (montés sur /media, /js, /css, ...)
- l'API (montée sur /api par exemple /api/blocks/46456)
- les pages (montées sur / avec un template générique configuré par API,
sur d'autres routes spécialisées)


base de données
---------------

Le contenu du site est géré par une seule table en relation n,n avec elle-même,
la table de "blocs":

```
type: le type sémantique (obligatoire)
mime: le type réel (obligatoire)
lang: langue ISO 639-1
data: attributs json (noms => html)
content: contenus html (noms => json)
```

D'autres colonnes, tables, et relations plus spécialisées peuvent être ajoutées;
par exemple l'administration du site a besoin d'une gestion des utilisateurs,
et des permissions.


composants
----------

Un composant est utilisé pour typer les blocs et les rendre éditables.

Ce qui est abordé ici est une relecture de la
[documentation de coed](https://github.com/kapouer/coed/blob/master/README.md).

Un composant a un nom qui sert à typer les blocs, et définit un schéma de bloc:
- des noms de données et leur schéma json
- des noms de contenus et leur schéma prosemirror

Un composant doit implémenter des fonctions pour parser et produire du DOM:
- saisi par l'utilisateur (input)
- utilisé lors de l'édition (from/to)
- exporté lors de la publication (output)

Données et contenus s'articulent ainsi par rapport au DOM parsés ou produits:
- le composant est entièrement responsable de parser et écrire les données
dans les différentes versions du DOM.
- les données ne sont éditables qu'à l'aide d'une interface utilisateur intégrée
par le composant dans le DOM éditable. Elles ne sont pas éditables en html.
- les contenus html éditables sont repérés par le composant en plaçant dans le
DOM d'édition un attribut `coed-name`.

Exemple: un titre d'article n'est pas une donnée, c'est un contenu avec un
schéma qui n'autorise que du html inline.
Un statut d'article (important, épinglé) ou une date sont des données, et le
composant qui les gère peut proposer un menu select ou un calendrier pour les
modifier.


enregistrement des contenus et références de blocs
--------------------------------------------------

La sérialisation des contenus est obtenue par la fonction toDOM() de l'éditeur,
sachant que les blocs imbriqués sont automatiquement (pas par l'éditeur mais
par `pageboard`) remplacés par un Node du genre
`<div data-bloc="/api/blocs/123"></div>`

Ce Node est appelé une *référence* de bloc.

- il porte un attribut qui donne une référence du bloc remplacé
- ce node doit avoir un 'layout' pour pouvoir faire du lazy loading
- un bloc peut ne pas être référencé mais entièrement "embarqué" dans le contenu,
à condition que son composant soit capable de le relire à partir du html publié.
Ce bloc embarqué n'a alors pas d'existence dans la base de données.

Les références de blocs décrites ici portent sur un seul bloc à la fois.

Voir plus bas l'algorithme de rendu d'un bloc, qui explique comment on peut
aussi faire le rendu d'une liste de blocs, ou même d'une liste de données
externes convertibles en blocs.


validation de bloc par composant
--------------------------------

Les schémas précisés dans un composant sont utilisés par le serveur pour valider
les blocs avant de les enregistrer dans la base de données.

- validation des données  
  À l'aide d'un validateur json-schéma comme `ajv`.
  On pourra essayer d'améliorer le niveau de validation dans l'éditeur de texte,
  qui pour l'instant ne fait que vérifier l'absence ou la présence d'attributs.

- validation des contenus  
  Il faut un TreeAdapter pour `parse5` qui n'expose que DOM Level 1 Core, ou plus
  simplement `jsdom`, passer le document obtenu au parseur de prosemirror configuré
  avec le même schéma que celui du contenu, et resérialiser pour vérifier que
  les contenus correspondent.
  Une solution sans jsdom est possible, en utilisant la représentation json du DOM,
  mais demande de soumettre le bloc avec cette représentation, ce qui n'est pas
  toujours plus simple.


web components
--------------

Un bloc est forcément une instance de composant, mais sa version de publication
peut aussi être une instance de web component.

Il faut bien garder en tête que les deux notions sont séparées, un web component
ne se met à exister qu'après le rendu d'un bloc.


rendu des blocs
---------------

1) une référence de bloc permet de récupérer auprès de l'API type, data, content
2) appeler components[type].output(data, content)
3) node.querySelectorAll([data-block]).forEach(refaire étape 1) et remplacer
le div par le html ainsi produit

La "récupération" du premier bloc doit aussi récupérer l'arbre des relations avec
ses sous-blocs, ce qui rend la récursion provoquée par 3) peu coûteuse en requêtes
additionnelles.


rendu de données externes
-------------------------

Il peut être parfois utile de pouvoir considérer une API qui n'a pas le même
format que l'API des blocs, ou encore de faire des recherches ou de la pagination
de blocs.

La bonne manière de faire cela dans `pageboard` est simplement de définir un
composant spécialisé qui va récupérer des données (distantes ou pas) et les
insérer en tant que blocs dans le contenu du bloc correspondant.

Le rendu de données externes ne peut cependant pas bénéficier dans le cas général
du préchargement des sous-blocs effectué lors de la récupération du bloc page.


rendu de listes
---------------

Si la référence de bloc renvoie une liste, alors tous les éléments récupérés
sont simplement ajoutés en utilisant les modes de rendus définis avant.

Par exemple, il est possible de placer une liste paginée de blocs si l'API
de blocs supporte des paramètres de pagination, ou une liste de données
obtenues d'une source externe.


pages
-----

Une page est un bloc identifié par un type "page" et un mime type "text/html".

Optionnellement, une page possède également deux données:

- `data.url`  
  doit correspondre à une route accessible de l'application, et le fait qu'elle
  soit prérendue dépend de l'application.

- `data.template`  
  indique le nom d'un document html (typiquement un chemin relatif vers un fichier
  html statique) qui sert de template.
  L'avantage de ne pas conserver les templates de pages dans la base de données
  est de les laisser modifiables facilement par les développeurs et par les
  scripts de déploiement.

Ne sont pas spécifiés (ni implémentés):
- la compilation de dépendances dynamiques
- l'enregistrement de templates de pages dans la base de données


spécialisation
--------------

Il peut arriver qu'on veuille utiliser `pageboard` dans un cadre plus précis
que le cadre général d'un CMS.

Dans le liveactu on a ces particularités:

- les composants représentent des ressources ou des articles
- les pages doivent pouvoir être exportées en json
- les articles doivent être insérés par une référence de liste
- le contenu des articles (aside, content, title) doit pouvoir être exporté en json
- les ressources utilisées dans les articles implémentent une forme de custom elements
avec du lazy loading

Toutes ces particularités entrent dans le cadre de pageboard car ce sont de
simples restrictions.

