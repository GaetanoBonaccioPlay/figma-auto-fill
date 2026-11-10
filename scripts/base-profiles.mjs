import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Profili di base (ADR 0002): ogni file .json della cartella viene validato. Un profilo non valido o un nome
// duplicato interrompono la build, così non si distribuisce un plugin con un profilo rotto.
export async function loadBaseProfiles(dir, validateProfile) {
  let files = [];
  try { files = (await readdir(dir)).filter(file => file.endsWith('.json')).sort(); }
  catch { return []; }
  const profiles = [];
  for (const file of files) {
    try {
      const profile = validateProfile(JSON.parse(await readFile(join(dir, file), 'utf8')));
      // Gli Abbinamenti confermati contengono i testi del cliente (livello Figma e riga dell'Excel): restano nei profili
      // personali dei designer e non finiscono nel repository né nel plugin distribuito.
      if (profile.confirmedMatches.length) {
        throw new Error(`confirmedMatches deve essere vuoto: contiene testi del cliente (${profile.confirmedMatches.length} voci). Svuotalo prima di promuovere il profilo`);
      }
      if (profiles.some(item => item.name.toLowerCase() === profile.name.toLowerCase())) throw new Error(`nome "${profile.name}" già usato da un altro Profilo di base`);
      profiles.push(profile);
    } catch (error) {
      throw new Error(`Profilo di base non valido (${join(dir, file)}): ${error.message}`);
    }
  }
  return profiles;
}
