import { ethers } from "ethers";
import { getActiveEip1193 } from "@/lib/wallet-provider";

/**
 * `personal_sign` atas pesan teks lewat dompet terpilih. Pesannya dikirim sebagai hex UTF-8, bentuk
 * yang diterima semua dompet; server memverifikasinya dengan `ethers.verifyMessage(teks, sig)`.
 */
export async function personalSign(message: string, address: string): Promise<string> {
  const ethereum = getActiveEip1193();
  if (!ethereum) throw new Error("No wallet available. Connect a wallet first.");
  const hex = ethers.hexlify(ethers.toUtf8Bytes(message));
  return (await ethereum.request({ method: "personal_sign", params: [hex, address] })) as string;
}
