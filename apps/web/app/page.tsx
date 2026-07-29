import { redirect } from 'next/navigation';

// La racine n'a pas de contenu propre : le tableau de bord est la page
// d'accueil réelle, et lui donner une URL nommée rend les liens partageables.
export default function Home() {
  redirect('/tableau-de-bord');
}
