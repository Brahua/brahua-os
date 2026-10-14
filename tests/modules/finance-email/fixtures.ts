// Plain-text bodies shaped like the real BCP, BBVA and Yape emails (read from the owner's Gmail on
// 2026-10-14), with invented amounts, names, cards and operation numbers. The real emails never enter
// the repo (it is public until ~2026-11-01).
import type { EmailMessage } from "@/modules/finance/email/types";

export const BCP_CARD = (opts: {
  kind?: "Crédito" | "Débito";
  symbol?: string;
  amount?: string;
  company?: string;
  when?: string;
  card?: string;
}) => {
  const kind = opts.kind ?? "Crédito";
  const symbol = opts.symbol ?? "$";
  const amount = opts.amount ?? "6.46";
  const company = opts.company ?? "TIENDA DEMO+";
  return `| |
| Hola Ana, Realizaste un consumo de ${symbol} ${amount} con tu Tarjeta de ${kind} BCP en ${company}. Por tu seguridad, te enviamos los datos de tu operación. |
| Monto |

| |
| Total del consumo | ${symbol} ${amount} |

| |
| Datos de la operación |

| |
| Operación realizada | Consumo Tarjeta de ${kind} |
| Fecha y hora | ${opts.when ?? "14 de octubre de 2026 - 12:10 AM"} |
| Número de Tarjeta de ${kind} | ************${opts.card ?? "1111"} |
| Empresa | ${company} |
| Número de operación | 0000000001 |

| |
| | | ¿No reconoces esta operación? Comunícate inmediatamente con nosotros. |
`;
};

export const BCP_TRANSFER = (opts: { amount?: string; to?: string; when?: string } = {}) =>
  `Hola *Ana Demo,*

Realizaste una transferencia de *S/ ${opts.amount ?? "400.00"}* desde tu *Clasica.*

Por tu seguridad, te enviamos los *datos de tu operación.*

*Montos*

Monto transferido *S/ ${opts.amount ?? "400.00"}* Tipo de cambio ** *Total cobrado al tipo de cambio* **

*Datos de la operación*

Operación realizada *Transferencia a terceros BCP* Fecha y hora *${opts.when ?? "11 de Octubre de 2026 - 09:53 AM"}* Enviado a *${opts.to ?? "Perez Quispe Maria L."}*
**** 3001
Moneda Soles Desde *Clasica*
**** 7028
Moneda Soles Desde *Clasica*
**** 7028 Enviado a **
**** 3001 Mensaje ** Canal *Banca Móvil BCP* Número de operación *00000002*
`;

export const YAPE_PAYMENT = (opts: { amount?: string; merchant?: string; when?: string } = {}) =>
  `Hola ANA,
¡Tu pago en ${opts.merchant ?? "TIENDA YAPE"}
 fue exitoso!

Monto total S/ ${opts.amount ?? "49.90"}

Fecha y hora: ${opts.when ?? "12 octubre 2026 - 07:36 p. m."}

Titular: ANA DEMO PEREZ

Celular: *** *** 111

ID de operación: 1700000000000
`;

export const BBVA_PLIN = (opts: { amount?: string; to?: string; when?: string } = {}) =>
  `| |
| Hola, ANA |
| Plineaste S/ ${opts.amount ?? "50.00"} a ${opts.to ?? "Luis M Torres R"} | |

| |
| Detalles de tu plineo |

| Celular: | •1111 |
| Destino: | Yape |
| ITF: | S/ 0.00 |
| Fecha y hora: | ${opts.when ?? "3 de octubre, 2026 12:19"} |
| Número de operación: | 0F4A3C9E0001 |
`;

export const BBVA_INTERBANK = (
  opts: { amount?: string; holder?: string; to?: string; own?: boolean } = {},
) =>
  ` BBVA

| |
| ### Hola, Ana Has realizado con éxito la operación: Transferencia interbancaria Importe transferido S/ ${opts.amount ?? "1000.00"}------------------------------ |
| Comisión | S/ 0.00 |
| ITF | S/ 0.00 |

DETALLES DE LA OPERACIÓN

Titular de la cuenta

${opts.holder ?? "Ana Demo Perez Quispe"}

Tipo de operación

Transferencia interbancaria

Número de operación

00000444000000000

Fecha y hora de la operación

04 octubre, 2026 09:51

Cuenta de origen

Contiahorro

Cuenta de destino

• 2858

Banco de destino

BANCO DE CRÉDITO DEL PERÚ

Nombre del beneficiario

${opts.to ?? "Carlos Demo Rojas"}

${opts.own ? "Esta cuenta es propia, la operación será exonerada del ITF." : ""}
Recuerda que, por ningún medio de comunicación ni por ningún motivo, te pediremos tus datos confidenciales.
`;

const FROM = {
  bcp: "notificaciones@notificacionesbcp.com.pe",
  bbva: "procesos@bbva.com.pe",
  yape: "notificaciones@yape.pe",
};

export const mail = (
  bank: keyof typeof FROM,
  subject: string,
  text: string,
  over: Partial<EmailMessage> = {},
): EmailMessage => ({
  id: "abc12345def67890",
  from: FROM[bank],
  subject,
  receivedAt: new Date("2026-10-14T05:10:02Z"),
  text,
  senderVerified: true,
  ...over,
});

export const SUBJECTS = {
  bcpCredit: "Realizaste un consumo con tu Tarjeta de Crédito BCP - Servicio de Notificaciones BCP",
  bcpDebit: "Realizaste un consumo con tu Tarjeta de Débito BCP - Servicio de Notificaciones BCP",
  bcpTransfer: "Constancia de Transferencia a Terceros BCP - Servicio de Notificaciones BCP",
  yape: "Pago exitoso",
  bbvaPlin: "Constancia de operación transferencia PLIN",
  bbvaPlinQr: "Constancia de operación transferencia PLIN con QR",
  bbvaInterbank: "BBVA - Constancia Transf. Interbancaria",
};
