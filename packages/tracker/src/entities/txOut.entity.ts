import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tx_out')
export class TxOutEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'token_amount', type: 'bigint' })
  tokenAmount: string;

  @Column({ name: 'output_index' })
  outputIndex: number;

  @Column({ name: 'block_height' })
  blockHeight: number;

  @Column({ name: 'spend_input_index', nullable: true })
  spendInputIndex: number | null;

  @Column({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'update_at' })
  updatedAt: Date;

  @Column({ type: 'bigint' })
  satoshis: string;

  @Column({ name: 'owner_pkh' })
  ownerPkh: string;

  @Column({ name: 'locking_script' })
  lockingScript: string;

  @Column({ name: 'xonly_pubkey' })
  xonlyPubkey: string;

  @Column()
  txid: string;

  @Column({ name: 'state_hash' })
  stateHash: string;

  @Column({ name: 'spend_txid', nullable: true })
  spendTxid: string | null;
}
