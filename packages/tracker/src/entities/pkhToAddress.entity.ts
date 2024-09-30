import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('pkh_to_address')
export class PkhToAddressEntity {
  @PrimaryColumn()
  owner_pkh: string;

  @Column()
  owner_address: string;
}