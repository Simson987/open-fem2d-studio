import { Fragment, type ReactNode } from "react";

/**
 * Zet een vertaalde tekst om naar JSX, met elk stuk tussen backticks als
 * `<code>`. De locales schrijven veldnamen uit de JSON-invoer zo
 * ("… overschrijft `solverStrategy` in de JSON-invoer."), zodat de zin in elke
 * taal in één sleutel blijft en de veldnaam toch als code getoond wordt.
 */
export function metCode(tekst: string): ReactNode {
  return tekst.split("`").map((deel, i) =>
    i % 2 === 1 ? <code key={i}>{deel}</code> : <Fragment key={i}>{deel}</Fragment>);
}
