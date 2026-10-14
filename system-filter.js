// Swipe Clean — identifica componentes de sistema que não devem virar cartas.
// São bibliotecas e drivers que outros programas e jogos usam (Visual C++, .NET,
// DirectX, SDKs, drivers...). Removê-los raramente libera espaço relevante e pode
// quebrar jogos e aplicativos. Ficam ocultos por padrão (dá para mostrar nas Configurações).

// Nomes que são sempre componentes, qualquer que seja a editora
const ALWAYS = [
  /visual c\+\+.*(redistributable|runtime|minimum|additional|library)/i,
  /\bvc_?redist/i,
  /\.net (framework|runtime|sdk|core|desktop runtime|host|targeting pack|native|multi-targeting|toolset|portable)/i,
  /microsoft \.net\b/i,
  /\basp\.net\b/i,
  /windows desktop runtime/i,
  /windows (software development kit|sdk|app certification kit|driver kit|kits)/i,
  /\bwinrt intellisense/i,
  /universal (crt|general midi)/i,
  /\bdirectx\b/i,
  /\bxna framework/i,
  /\bphysx\b/i,
  /\bopenal\b/i,
  /webview2 runtime/i,
  /\bvulkan run ?time/i,
  /microsoft gameinput/i,
  /microsoft update health tools/i,
  /windows (driver package|pc health check)/i,
  /\bdriver package\b/i,
  /microsoft edge update/i,
  /microsoft visual studio (installer|setup configuration|tools for applications|2010 tools for office runtime)/i,
  /\bvs_[a-z]/i,
  /\bsql server\b.*\bsetup\b/i,
  /\bintellitrace/i,
  /\bweb deploy\b/i,
  /\bsql server\b.*(setup support files|browser|vss writer|sql writer|batch parser|language service|management objects|clr types|lockdown|common files|shared features|t-sql|dacfx|dac framework)/i,
  /\b(odbc|ole db) (driver|provider)\b/i,
  /system clr types/i,
  /shared management objects/i,
  /\bentity framework .*tools/i,
  /\bwindows app runtime\b/i,
  /\bwindows app sdk\b/i,
  /\bapplication verifier\b/i,
  /\bkits configuration installer\b/i,
  /\bsdk arm\w* (additions|redistributables)/i,
  /\bclickonce bootstrapper/i,
  /\bmsi development tools\b/i,
  /\bwindows ip over usb\b/i,
];

// Componentes da Microsoft identificados por palavras típicas de bibliotecas/ferramentas internas
const MICROSOFT_PART =
  /\b(runtime|redistributable|targeting pack|framework|toolset|components?|support files|intellisense|templates?|manifest|host fx|hostfx|shared framework|libraries|library|clr types|provider|bootstrapper|language pack|resources|apphost|pack|emulator|sdk)\b/i;

// Drivers e utilitários de fabricantes de hardware (o app principal deles continua visível)
const HARDWARE_VENDOR = /(nvidia|intel|realtek|amd|advanced micro devices|qualcomm|broadcom|synaptics|elan|logitech|razer|corsair|asus|msi|gigabyte|dolby|waves|conexant|via technologies)/i;
const HARDWARE_PART =
  /\b(driver|chipset|firmware|management engine|serial io|rapid storage|optane|wireless bluetooth|bluetooth|hd audio|audio driver|usb ?c|frameview|telemetry|physx|container|virtual audio|update helper)\b/i;

function isSystemComponent(name, publisher) {
  const n = String(name || '');
  const p = String(publisher || '');
  if (!n) return false;
  if (ALWAYS.some((re) => re.test(n))) return true;
  if (/microsoft/i.test(p) && MICROSOFT_PART.test(n)) return true;
  if ((HARDWARE_VENDOR.test(p) || HARDWARE_VENDOR.test(n)) && HARDWARE_PART.test(n)) return true;
  return false;
}

module.exports = { isSystemComponent };
