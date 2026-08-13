import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('waitlist_entries')
export class WaitlistEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Index({ unique: true })
  @Column({ unique: true })
  email: string;

  @Column({ type: 'boolean' })
  consent: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
