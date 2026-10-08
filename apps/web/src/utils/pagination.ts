export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];
export const DEFAULT_PAGE_SIZE = 50;

export const splitFilterValues = (value: string) => (value ? value.split("|").filter(Boolean) : []);
