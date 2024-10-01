import { DataSource } from 'typeorm';
import { ormConfig } from '../config/db.config';
import { TxOutEntity } from '../entities/txOut.entity';
import { PkhToAddressEntity } from '../entities/pkhToAddress.entity';
import { TokenMintEntity } from '../entities/tokenMint.entity';
import { TxEntity } from '../entities/tx.entity';
import { TokenInfoEntity } from '../entities/tokenInfo.entity';
import { BlockEntity } from '../entities/block.entity';
import { TxOutArchiveEntity } from '../entities/txOutArchive.entity';

const AppDataSource = new DataSource(ormConfig);

async function clearDatabase() {
  const connection = await AppDataSource.initialize();

  try {
    const entityManager = connection.manager;

    // 清空所有表
    await entityManager.query('TRUNCATE TABLE block CASCADE');
    await entityManager.query('TRUNCATE TABLE token_info CASCADE');
    await entityManager.query('TRUNCATE TABLE token_mint CASCADE');
    await entityManager.query('TRUNCATE TABLE tx CASCADE');
    await entityManager.query('TRUNCATE TABLE tx_out CASCADE');
    await entityManager.query('TRUNCATE TABLE tx_out_archive CASCADE');
    await entityManager.query('TRUNCATE TABLE pkh_to_address CASCADE');

    console.log('All tables have been cleared successfully.');
  } catch (error) {
    console.error('Error clearing database:', error);
  } finally {
    await connection.close();
  }
}

clearDatabase().catch(console.error);