export const PORTAL_ENVIRONMENTS = ["beta", "prod"];

const emptyTestUsers = () => ({ INTENSIVE: [], ACADEMY: [], EXTERNAL: [], NIAT: [], OFFLINE: [] });

export const PORTAL_DEFAULTS = {
  beta: { baseUrl: "", applyLinkTemplate: "", testUsers: emptyTestUsers() },
  prod: { baseUrl: "", applyLinkTemplate: "", testUsers: emptyTestUsers() },
};
