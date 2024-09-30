import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('tx_out')
export class TxOutEntity {
  @PrimaryColumn()
  txid: string;

  @PrimaryColumn({ name: 'output_index' })
  outputIndex: number;

  @Column({ name: 'token_amount', type: 'bigint', nullable: true })
  tokenAmount: string;

  @Column({ name: 'block_height' })
  blockHeight: number;

  @Column({ name: 'spend_input_index', nullable: true })
  spendInputIndex: number | null;

  @Column({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'update_at' })  // 修改这里
  updateAt: Date;  // 修改这里

  @Column({ type: 'bigint' })
  satoshis: string;

  @Column({ name: 'owner_pkh', nullable: true })
  ownerPkh: string;

  @Column({ name: 'locking_script' })
  lockingScript: string;

  @Column({ name: 'xonly_pubkey' })
  xonlyPubkey: string;

  @Column({ name: 'state_hash', nullable: true })
  stateHash: string;

  @Column({ name: 'spend_txid', nullable: true })
  spendTxid: string | null;
}
