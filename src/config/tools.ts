export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Busca en la web información actual y devuelve fuentes con URL.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Consulta de búsqueda" } },
      required: ["query"],
    },
  },
} as const;
