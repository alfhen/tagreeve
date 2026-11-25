/** Numbers the pages of one run from 0 in the order they are first seen. A page is a tab or a popup. Never a URL. */
export function createPageNumbers(): (page: object) => number {
  const numbers = new WeakMap<object, number>();
  let next = 0;
  return (page) => {
    let number = numbers.get(page);
    if (number === undefined) {
      number = next++;
      numbers.set(page, number);
    }
    return number;
  };
}
