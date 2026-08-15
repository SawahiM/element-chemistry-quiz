export type ColorTerm = {
  id: string;
  name: string;
  acceptedColorIds?: string[];
};

export type ColorAwareObservation = {
  colorId: string;
  acceptedColorIds?: string[];
};

export function acceptedColorIds(item: ColorAwareObservation): string[] {
  return item.acceptedColorIds?.length ? item.acceptedColorIds : [item.colorId];
}

export function acceptedColorSet(item: ColorAwareObservation): Set<string> {
  return new Set(acceptedColorIds(item));
}

export function observationAcceptsColor(item: ColorAwareObservation, colorId: string): boolean {
  return acceptedColorIds(item).includes(colorId);
}

export function groupByAcceptedColor<T extends ColorAwareObservation>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    acceptedColorIds(item).forEach((colorId) => {
      const group = groups.get(colorId) || [];
      group.push(item);
      groups.set(colorId, group);
    });
  });
  return groups;
}

export function colorNames(colors: ColorTerm[]): Map<string, string> {
  return new Map(colors.map((color) => [color.id, color.name]));
}

export function colorAcceptanceIndex(colors: ColorTerm[]): Map<string, Set<string>> {
  return new Map(colors.map((color) => [
    color.id,
    new Set(color.acceptedColorIds?.length ? color.acceptedColorIds : [color.id]),
  ]));
}

export function colorTermsHaveAcceptanceRelation(
  acceptance: Map<string, Set<string>>,
  leftColorId: string,
  rightColorId: string,
): boolean {
  if (leftColorId === rightColorId) return false;
  const leftAccepted = acceptance.get(leftColorId) || new Set([leftColorId]);
  const rightAccepted = acceptance.get(rightColorId) || new Set([rightColorId]);
  return [...leftAccepted].some((colorId) => rightAccepted.has(colorId));
}
