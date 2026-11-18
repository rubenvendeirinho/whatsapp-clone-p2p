export const othersOf = (conv, me) => conv.participants.filter((p) => p !== me);
export const isGroup = (conv) => conv.participants.length > 2;
export const convTitle = (conv, me, nameOf) => othersOf(conv, me).map(nameOf).join(", ") || "Eu";
