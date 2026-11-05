"use client";
/** The in-page approval shown before the wallet opens for an Arkiv write. */
import { motion } from "motion/react";
import { formatEther, formatGwei } from "viem";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const group = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function ApprovalCard({
  what,
  account,
  gas,
  gasPrice,
  maximumCostWei,
  onApprove,
  onCancel,
}: {
  what: string;
  account?: string | null;
  gas: bigint;
  gasPrice: bigint;
  maximumCostWei: bigint;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      className="apv"
      role="alertdialog"
      aria-labelledby="apv-h"
      aria-describedby="apv-d"
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
    >
      <div className="apv__head">
        <span className="apv__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 17.5c2.2 0 3-4.5 5-4.5s1.6 3 3.6 3 2.4-2.4 4.4-2.4M15.5 5.5l3 3L10 17H7v-3l8.5-8.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div>
          <h3 id="apv-h">Confirm this Arkiv write</h3>
          <p id="apv-d">One entity, signed by your wallet. Nothing is sent until you confirm in the wallet too.</p>
        </div>
      </div>

      <dl className="apv__rows">
        <div><dt>Writing</dt><dd className="mono">{what}</dd></div>
        <div><dt>Network</dt><dd><i className="dot dot--ok" aria-hidden="true" />Rabdi, Arkiv testnet</dd></div>
        {account && <div><dt>Signing wallet</dt><dd className="mono">{short(account)}</dd></div>}
        <div><dt>Gas limit</dt><dd>{group(gas)}</dd></div>
        <div><dt>Gas price</dt><dd>{formatGwei(gasPrice)} gwei</dd></div>
        <div className="apv__fee"><dt>Maximum fee</dt><dd>{formatEther(maximumCostWei)} <small>tGLM</small></dd></div>
      </dl>

      <div className="apv__foot">
        <ol className="apv__steps" aria-label="What happens next">
          <li className="is-now"><span>1</span>Approve here</li>
          <li><span>2</span>Confirm in your wallet</li>
        </ol>
        <div className="apv__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={onApprove} autoFocus>Approve and open wallet</button>
        </div>
      </div>
    </motion.div>
  );
}
