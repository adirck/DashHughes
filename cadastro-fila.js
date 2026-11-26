const vault = "dashhughes-cadastro-v1";
const encode = value => new TextEncoder().encode(value);
const b64 = bytes => btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(""));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export async function unlockCadastro(user, password) {
  const account = b64(await crypto.subtle.digest("SHA-256", encode(user.trim())));
  const storageName = vault + ":" + account;
  const saltName = storageName + ":salt";
  let salt = localStorage.getItem(saltName);
  if (!salt) {
    salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem(saltName, salt);
  }
  const material = await crypto.subtle.importKey("raw", encode(password), "PBKDF2", false, ["deriveBits"]);
  const key = await crypto.subtle.deriveBits({
    name: "PBKDF2", salt: bytes(salt), iterations: 600000, hash: "SHA-256"
  }, material, 256);
  sessionStorage.setItem(vault, JSON.stringify({storageName, key: b64(key)}));
}

export function lockCadastro() { sessionStorage.removeItem(vault); }

export function cadastroQueue() {
  const session = JSON.parse(sessionStorage.getItem(vault) || "null");
  if (!session || !navigator.locks) return null;
  const key = crypto.subtle.importKey("raw", bytes(session.key), "AES-GCM", false, ["encrypt", "decrypt"]);
  const aad = encode(session.storageName);
  const open = async () => {
    const raw = localStorage.getItem(session.storageName);
    if (!raw) return {snapshot: null, updated: null, edits: []};
    const {iv, data} = JSON.parse(raw);
    const plain = await crypto.subtle.decrypt({name: "AES-GCM", iv: bytes(iv), additionalData: aad}, await key, bytes(data));
    return JSON.parse(new TextDecoder().decode(plain));
  };
  const write = async state => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad}, await key, encode(JSON.stringify(state)));
    localStorage.setItem(session.storageName, JSON.stringify({iv: b64(iv), data: b64(data)}));
  };
  const run = action => navigator.locks.request(session.storageName, async () => {
    if (JSON.parse(sessionStorage.getItem(vault) || "null")?.storageName !== session.storageName) throw new Error("Sessão do cadastro encerrada.");
    return action(await open());
  });
  const record = (snapshot, edit) => edit.kind === "loja"
    ? snapshot?.lojas.find(r => r.host === edit.body.host)
    : snapshot?.supervisores.find(r => r.id === edit.body.id);
  const matches = (row, body) => row &&
    Object.entries(body).every(([field, value]) => field === "versao" || (row[field] ?? "") === value) &&
    row.versao === (body.versao ?? 0) + 1;
  return {
    read: () => run(state => state),
    remember: snapshot => run(async state => {
      state.snapshot = snapshot;
      state.updated = Date.now();
      await write(state);
      return state;
    }),
    enqueue: (kind, body) => run(async state => {
      const id = kind + ":" + (body.host ?? body.id);
      if (state.edits.some(edit => edit.id === id)) throw new Error("Já existe uma alteração pendente para este registro.");
      state.edits.push({id, kind, body, status: "pending"});
      await write(state);
      return state;
    }),
    discard: id => run(async state => {
      state.edits = state.edits.filter(edit => edit.id !== id);
      await write(state);
      return state;
    }),
    sync: (snapshot, send) => run(async state => {
      for (const edit of [...state.edits]) {
        if (edit.status !== "pending") continue;
        const existing = record(snapshot, edit);
        if (matches(existing, edit.body)) {
          state.edits = state.edits.filter(item => item.id !== edit.id);
          await write(state);
          continue;
        }
        if (existing ? existing.versao !== edit.body.versao : edit.body.versao !== undefined) {
          edit.status = "conflict";
          await write(state);
          continue;
        }
        try {
          await send(edit.kind, edit.body);
          state.edits = state.edits.filter(item => item.id !== edit.id);
          await write(state);
        } catch (error) {
          if (error.status === 409) edit.status = "conflict";
          else if ([400, 404, 422].includes(error.status)) edit.status = "rejected";
          else break;
          await write(state);
        }
      }
      return state;
    })
  };
}
