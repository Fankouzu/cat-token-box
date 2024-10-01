import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('pkh_to_address')
export class PkhToAddressEntity {
  @PrimaryColumn({ name: 'owner_pkh', type: 'varchar', length: 40 })
  ownerPkh: string;

  @Column({ name: 'owner_address', type: 'varchar', length: 100, nullable: true })
  ownerAddress: string;
}