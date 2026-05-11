import { cifrar, descifrar } from "./lib/cifrado.ts";

const mensaje  = "Contraseña router: Admin#2025";
const claveVig = "salta2025";
const claveAes = "mi-clave-secreta";

console.log("=== PRUEBA DEL MOTOR DE CIFRADO ===\n");
console.log("Mensaje original:", mensaje);

const cifrado = cifrar(mensaje, claveVig, claveAes);
console.log("Texto cifrado:  ", cifrado);

const descifrado = descifrar(cifrado, claveVig, claveAes);
console.log("Descifrado:     ", descifrado);

console.log("\nResultado:", mensaje === descifrado ? "EXITO" : "ERROR");