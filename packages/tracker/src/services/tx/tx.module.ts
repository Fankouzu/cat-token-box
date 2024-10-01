import { Module } from '@nestjs/common';
import { TxService } from './tx.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TxEntity } from '../../entities/tx.entity';
import { TxOutEntity } from '../../entities/txOut.entity';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { TokenMintEntity } from '../../entities/tokenMint.entity';
import { PkhToAddressEntity } from '../../entities/pkhToAddress.entity';
import { CommonModule } from '../common/common.module'; // 添加这行

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TxEntity,
      TxOutEntity,
      TokenInfoEntity,
      TokenMintEntity,
      PkhToAddressEntity,
    ]),
    CommonModule, // 添加这行
  ],
  providers: [TxService],
  exports: [TxService],
})
export class TxModule {}
